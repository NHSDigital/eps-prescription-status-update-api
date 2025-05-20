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

const NHS_NOTIFY_ROUTING_ID = "b838b13c-f98c-4def-93f0-515d4e4f4ee1" // process.env.NHS_NOTIFY_ROUTING_ID

/**
 * Handler for the scheduled trigger.
 *
 * @param event - The CloudWatch EventBridge scheduled event payload.
 */
export const lambdaHandler = async (event: EventBridgeEvent<string, string>): Promise<void> => {
  // EventBridge jsonifies the details so the second type of the event is a string. That's unused here, though

  logger.info("NHS Notify lambda triggered by scheduler", {event})

  let queueDrained = false

  // keep pulling until drainQueue tells us the queue is effectively empty
  while (!queueDrained) {
    const {messages, isEmpty} = await drainQueue(logger, 100)
    queueDrained = isEmpty

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
    const suppressed = eligibility
      .filter((e) => !e.allowed)
      .map((e) => e.message)

    // Log the results of checking the cooldown
    const suppressedCount = suppressed.length
    if (toProcess.length === 0) {
      logger.info("All messages suppressed by cooldown; nothing to notify",
        {
          suppressedCount,
          totalFetched: messages.length
        })
    } else if (suppressedCount > 0) {
      logger.info(`Suppressed ${suppressedCount} messages due to cooldown`,
        {
          suppressedCount,
          totalFetched: messages.length
        }
      )
    }

    if (suppressed.length) {
      // Consider suppressed messages to have been processed and delete them from SQS
      await clearCompletedSQSMessages(logger, suppressed)
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
    const processed: Array<NotifyDataItemMessage> = []
    if (!NHS_NOTIFY_ROUTING_ID) throw new Error("NHS_NOTIFY_ROUTING_ID environment variable not set.")
    try {
      const results = await makeBatchNotifyRequest(
        logger, NHS_NOTIFY_ROUTING_ID, toProcess.map((el) => el.PSUDataItem)
      )
      processed.push(...results)
    } catch (error) {
      logger.error("Failed to make notification requests for these these messages. Will retry",
        {error, failedMessages: toProcess}
      )
    }

    if (processed.length) {
      // Processed messages are pushed to the database
      await addPrescriptionMessagesToNotificationStateStore(logger, processed)

      // By waiting until a message is successfully processed before deleting it from SQS,
      // failed messages will eventually be retried by subsequent notify consumers.
      await clearCompletedSQSMessages(logger, processed)
    }
  }
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
