import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

const logger = new Logger({serviceName: "nhsNotify"})

/**
 * Handler for the scheduled trigger.
 *
 * @param event - The CloudWatch EventBridge scheduled event payload.
 */
const lambdaHandler = async (event: EventBridgeEvent<never, string>): Promise<void> => {
  // FIXME: use proper typing for the above argument.
  // EventBridge jsonifies the details so the second on is a string

  logger.info("NHS Notify lambda triggered by scheduler", {event})

  // TODO: Notifications logic will be done here.
  // - pick off SQS messages
  // - query PrescriptionNotificationState
  // - process prescriptions, build NHS notify payload
  // - Make NHS notify request
  // Don't forget to make appropriate logs.
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
