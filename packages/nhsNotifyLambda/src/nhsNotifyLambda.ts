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

/**
 * Process a single batch of SQS messages: filter, notify, persist, and clean up.
 */
async function processBatch(
  messages: Array<NotifyDataItemMessage>,
  routingId: string
): Promise<void> {
  if (messages.length === 0) {
    console.log("No messages to process")
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
    await addPrescriptionMessagesToNotificationStateStore(logger, processed)
    await removeSQSMessages(logger, processed)
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
 * Drain the queue until empty, processing each batch.
 */
async function drainAndProcess(routingId: string): Promise<void> {
  let empty = false
  while (!empty) {
    const {messages, isEmpty} = await drainQueue(logger, 100)
    empty = isEmpty
    console.log(messages)
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

  logger.info("NHS Notify lambda triggered by scheduler", {event})
  logger.info("Routing Plan ID:", {routingId})

  await reportQueueStatus(logger)
  await drainAndProcess(routingId)
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({logger: (req) => logger.info(req)})
  )
  .use(errorHandler({logger}))
