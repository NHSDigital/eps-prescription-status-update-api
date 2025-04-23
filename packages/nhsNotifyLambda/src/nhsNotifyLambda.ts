import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"

import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {DataItem} from "./types"
import {drainQueue} from "./utils"

const logger = new Logger({serviceName: "nhsNotify"})

/**
 * Handler for the scheduled trigger.
 *
 * @param event - The CloudWatch EventBridge scheduled event payload.
 */
export const lambdaHandler = async (event: EventBridgeEvent<never, string>): Promise<void> => {
  // EventBridge jsonifies the details so the second type of the event is a string. That's unused here, though

  logger.info("NHS Notify lambda triggered by scheduler", {event})

  try {
    const messages = await drainQueue(logger, 100)
    logger.info("messages", {messages})

    if (messages.length === 0) {
      logger.info("No messages to process")
      return
    }

    // parse & log each DataItem as a placeholder for now.
    const items = messages.map((m) => {
      try {
        return JSON.parse(m.Body!) as DataItem
      } catch (err) {
        logger.error("Failed to parse message body", {body: m.Body, error: err})
        return null
      }
    }).filter((i): i is DataItem => i !== null)

    logger.info("Fetched prescription notification messages", {count: items.length, items})

    // TODO: Notifications logic will be done here.
    // - query PrescriptionNotificationState
    // - process prescriptions, build NHS notify payload
    // - Make NHS notify request
    // Don't forget to make appropriate logs!

  } catch (err) {
    logger.error("Error while draining SQS queue", {error: err})
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
