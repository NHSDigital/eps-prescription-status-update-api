import {EventBridgeEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

import {reportQueueStatus} from "./sqs"
import {processPostDatedQueue} from "./orchestration"

const logger = new Logger({serviceName: "postDatedLambda"})

/**
 * Handler for the scheduled EventBridge trigger.
 */
export const lambdaHandler = async (
  event: EventBridgeEvent<string, string>
): Promise<void> => {
  logger.info("Post-dated handling lambda triggered by scheduler", {event})

  // Report queue status *before* processing
  await reportQueueStatus(logger)

  // work through the queue
  await processPostDatedQueue(logger)
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({logger: (req) => logger.info(req)})
  )
  .use(errorHandler({logger}))
