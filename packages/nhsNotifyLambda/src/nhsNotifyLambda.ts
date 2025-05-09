import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"

import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {
  addPrescriptionMessagesToNotificationStateStore,
  clearCompletedSQSMessages,
  drainQueue,
  PSUDataItemMessage
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

  let messages: Array<PSUDataItemMessage>
  try {
    messages = await drainQueue(logger, 100)

    if (messages.length === 0) {
      logger.info("No messages to process")
      return
    }

    const toNotify = messages.map((m) => ({
      RequestID: m.PSUDataItem.RequestID,
      TaskId: m.PSUDataItem.TaskID,
      Message: "Notification Required"
    }))
    logger.info("Fetched prescription notification messages", {count: toNotify.length, toNotify})

    // TODO: Notifications logic will be done here.
    // - query PrescriptionNotificationState
    // - process prescriptions, build NHS notify payload
    // - Make NHS notify request
    // Don't forget to make appropriate logs!

  } catch (err) {
    logger.error("Error while draining SQS queue", {error: err})
    throw err
  }

  try {
    await addPrescriptionMessagesToNotificationStateStore(logger, messages)
  } catch (err) {
    logger.error("Error while pushing data to the PSU notification state data store", {err})
    throw err
  }

  // By waiting until a message is successfully processed before deleting it from SQS,
  // failed messages will eventually be retried by subsequent notify consumers.
  try {
    await clearCompletedSQSMessages(logger, messages)
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
