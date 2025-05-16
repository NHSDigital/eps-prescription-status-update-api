import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"

import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {
  addPrescriptionMessagesToNotificationStateStore,
  checkCooldownForUpdate,
  clearCompletedSQSMessages,
  drainQueue,
  makeBatchNotifyRequest,
  NotifyDataItemMessage
} from "./utils"

const logger = new Logger({serviceName: "nhsNotify"})

const NHS_NOTIFY_ROUTING_ID = process.env.NHS_NOTIFY_ROUTING_ID

/**
 * Handler for the scheduled trigger.
 *
 * @param event - The CloudWatch EventBridge scheduled event payload.
 */
export const lambdaHandler = async (event: EventBridgeEvent<string, string>): Promise<void> => {
  // EventBridge jsonifies the details so the second type of the event is a string. That's unused here, though

  logger.info("NHS Notify lambda triggered by scheduler", {event})

  let messages: Array<NotifyDataItemMessage>
  let processed: Array<NotifyDataItemMessage> = []

  // TODO: Loop this while there are significant numbers of messages on the queue. At least 30?
  messages = await drainQueue(logger, 100)

  if (messages.length === 0) {
    logger.info("No messages to process")
    return
  }

  // Filter messages by checkCooldownForUpdate. This is done in two stages so we can check in parallel
  const eligibility = await Promise.all(
    messages.map(async (m) => ({
      message: m,
      allowed: await checkCooldownForUpdate(logger, m.PSUDataItem)
    }))
  )
  const toProcess = eligibility
    .filter((e) => e.allowed)
    .map((e) => e.message)

  // Log the results of checking the cooldown
  const suppressedCount = messages.length - toProcess.length
  if (toProcess.length === 0) {
    logger.info("All messages suppressed by cooldown; nothing to notify",
      {
        suppressedCount,
        totalFetched: messages.length
      })
    return
  } else if (suppressedCount > 0) {
    logger.info(`Suppressed ${suppressedCount} messages due to cooldown`,
      {
        suppressedCount,
        totalFetched: messages.length
      }
    )
  }

  // Just for diagnostics for now
  const toNotify = toProcess
    .map((m) => ({
      RequestID: m.PSUDataItem.RequestID,
      TaskId: m.PSUDataItem.TaskID,
      Message: "Notification Required"
    }))
  logger.info("Fetched prescription notification messages", {count: toNotify.length, toNotify})

  // Make the request. If it's successful, add the relevant messages to the list of processed messages.
  if (!NHS_NOTIFY_ROUTING_ID) throw new Error("NHS_NOTIFY_ROUTING_ID environment variable not set.")
  try {
    await makeBatchNotifyRequest(
      logger, NHS_NOTIFY_ROUTING_ID, toProcess.map((el) => el.PSUDataItem)
    )
    processed = processed.concat(toProcess)
  } catch (error) {
    logger.error("Failed to make notification requests for these these messages:", {error, failedMessages: toProcess})
  }

  await addPrescriptionMessagesToNotificationStateStore(logger, processed)

  // By waiting until a message is successfully processed before deleting it from SQS,
  // failed messages will eventually be retried by subsequent notify consumers.
  await clearCompletedSQSMessages(logger, processed)
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(errorHandler({logger: logger}))
