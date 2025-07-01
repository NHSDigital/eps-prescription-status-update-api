import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"

import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {getParameter} from "@aws-lambda-powertools/parameters/ssm"

import {
  addPrescriptionMessagesToNotificationStateStore,
  checkCooldownForUpdate,
  removeSQSMessages,
  reportQueueStatus,
  drainQueue,
  makeBatchNotifyRequest,
  NotifyDataItemMessage
} from "./utils"

const logger = new Logger({serviceName: "nhsNotify"})

const MAX_QUEUE_RUNTIME = 14*60*1000 // 14 minutes, to avoid Lambda timeout issues (timeout is 15 minutes)

/**
 * Process a single batch of SQS messages: filter, notify, persist, and clean up.
 */
async function processBatch(
  messages: Array<NotifyDataItemMessage>,
  routingId: string
): Promise<void> {
  if (messages.length === 0) {
    logger.info("No messages to process")
    return
  }

  // Filter by cooldown
  const checks = await Promise.all(
    messages.map(async (msg) => ({
      msg,
      allowed: await checkCooldownForUpdate(logger, msg.PSUDataItem)
    }))
  )
  const toProcess = checks.filter(c => c.allowed).map(c => c.msg)
  const suppressed = checks.filter(c => !c.allowed).map(c => c.msg)

  logSuppression(suppressed.length, messages.length)
  if (suppressed.length) {
    await removeSQSMessages(logger, suppressed)
  }

  // Send notifications
  let processed: Array<NotifyDataItemMessage> = []
  try {
    processed = await makeBatchNotifyRequest(logger, routingId, toProcess)
  } catch (err) {
    logger.error("Notification request failed, will retry", {error: err, toProcess})
  }

  if (processed.length) {
    await Promise.all([
      addPrescriptionMessagesToNotificationStateStore(logger, processed),
      removeSQSMessages(logger, processed)
    ])
  }
}

/**
 * Log suppression details (sonar complained of high code complexity)
 */
function logSuppression(suppressedCount: number, total: number): void {
  if (suppressedCount === total) {
    logger.info("All messages suppressed by cooldown; nothing to notify", {
      suppressedCount,
      totalFetched: total
    })
  } else if (suppressedCount > 0) {
    logger.info(`Suppressed ${suppressedCount} messages due to cooldown`, {
      suppressedCount,
      totalFetched: total
    })
  }
}

/**
 * Drain the queue until empty or the MAX_QUEUE_RUNTIME has passed, processing each batch.
 */
async function drainAndProcess(routingId: string): Promise<void> {
  const start = Date.now()
  let empty = false
  while (!empty) {
    if (Date.now() - start >= MAX_QUEUE_RUNTIME) {
      logger.warn("drainAndProcess timed out; exiting before queue is empty",
        {maxRuntimeMilliseconds: MAX_QUEUE_RUNTIME}
      )
      break
    }

    const {messages, isEmpty} = await drainQueue(logger, 100)
    empty = isEmpty

    await processBatch(messages, routingId)
  }
}

/**
 * Handler for the scheduled EventBridge trigger.
 */
export const lambdaHandler = async (
  event: EventBridgeEvent<string, string>
): Promise<void> => {
  if (!process.env.NHS_NOTIFY_ROUTING_ID_PARAM) {
    throw new Error("Environment not configured")
  }
  const routingId = await getParameter(process.env.NHS_NOTIFY_ROUTING_ID_PARAM)
  if (!routingId) {
    throw new Error("No Routing Plan ID found")
  }

  logger.info("NHS Notify lambda triggered by scheduler", {event, routingId})

  // Done sequentially so that the queue report is accurate.
  await reportQueueStatus(logger)
  await drainAndProcess(routingId)
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({logger: (req) => logger.info(req)})
  )
  .use(errorHandler({logger}))
