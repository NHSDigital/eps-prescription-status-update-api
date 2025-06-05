import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"

import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {v4} from "uuid"

import {
  addPrescriptionMessagesToNotificationStateStore,
  checkCooldownForUpdate,
  clearCompletedSQSMessages,
  drainQueue,
  NotifyDataItemMessage
} from "./utils"

const logger = new Logger({serviceName: "nhsNotify"})

/**
 * Handler for the scheduled trigger.
 *
 * @param event - The CloudWatch EventBridge scheduled event payload.
 */
export const lambdaHandler = async (event: EventBridgeEvent<string, string>): Promise<void> => {
  // EventBridge jsonifies the details so the second type of the event is a string. That's unused here, though

  logger.info("NHS Notify lambda triggered by scheduler", {event})

  let messages: Array<NotifyDataItemMessage>
  let processed: Array<NotifyDataItemMessage>
  try {
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

    // TODO: Notifications request will be done here.
    processed = toProcess.map((el) => {
      return {
        ...el,
        success: true,
        notifyMessageId: v4()
      }
    })

  } catch (err) {
    logger.error("Error while draining SQS queue", {error: err})
    throw err
  }

  try {
    await addPrescriptionMessagesToNotificationStateStore(logger, processed)
  } catch (err) {
    logger.error("Error while pushing data to the PSU notification state data store", {err})
    throw err
  }

  // By waiting until a message is successfully processed before deleting it from SQS,
  // failed messages will eventually be retried by subsequent notify consumers.
  try {
    await clearCompletedSQSMessages(logger, processed)
  } catch (err) {
    logger.error("Error while deleting successfully processed messages from SQS", {error: err})
    throw err
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
