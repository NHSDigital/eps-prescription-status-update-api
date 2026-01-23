import {EventBridgeEvent} from "aws-lambda"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import errorHandler from "@nhs/fhir-middy-error-handler"

const logger = new Logger({serviceName: "postDatedLambda"})

/**
 * Placeholder handler that simply confirms the scheduled trigger fired.
 * This allows the infrastructure to be exercised before real business logic lands.
 */
export const lambdaHandler = async (
  event: EventBridgeEvent<string, string>
): Promise<void> => {
  logger.info("Post-dated lambda placeholder invoked", {event})
  logger.info("Hello world from the post-dated prescriptions lambda")
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(inputOutputLogger({logger: (req) => logger.info(req)}))
  .use(errorHandler({logger}))
