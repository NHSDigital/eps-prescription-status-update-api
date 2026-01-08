import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

const logger = new Logger({serviceName: "postDatedLambda"})

/**
 * Handler for the scheduled EventBridge trigger.
 */
export const lambdaHandler = async (
  event: EventBridgeEvent<string, string>
): Promise<void> => {
  logger.info("Post-dated handling lambda triggered by scheduler", {event})
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({logger: (req) => logger.info(req)})
  )
  .use(errorHandler({logger}))
