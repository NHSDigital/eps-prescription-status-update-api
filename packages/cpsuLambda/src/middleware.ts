import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {MiddyfiedHandler} from "@middy/core"
import {APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {validationErrorHandler} from "./errorHandler"

export type MiddlewareApplicator = <Event>(
  handler: MiddyfiedHandler<Event, APIGatewayProxyResult>,
  logger: Logger,
  schema?: object
) => MiddyfiedHandler<Event, APIGatewayProxyResult>

export const MIDDLEWARE: Record<string, MiddlewareApplicator> = {
  injectLambdaContext: (handler, logger) =>
    handler.use(injectLambdaContext(logger, {clearState: true})),
  httpHeaderNormalizer: (handler) =>
    handler.use(httpHeaderNormalizer()),
  inputOutputLogger: (handler, logger) =>
    handler.use(inputOutputLogger({
      logger: (request) => {
        const response = (request as {response?: unknown} | null | undefined)?.response
        if (response === undefined) {
          logger.info("inputOutputLogger request", {request})
        } else {
          logger.debug("inputOutputLogger response", {response})
        }
      }
    })),
  validator: (handler, logger, schema) =>
    handler.use(validator({eventSchema: transpileSchema(schema as object)})),
  validationErrorHandler: (handler, logger) =>
    handler.use(validationErrorHandler({logger: logger}))
}

export const DEFAULT_HANDLER_MIDDLEWARE = [
  MIDDLEWARE.injectLambdaContext,
  MIDDLEWARE.httpHeaderNormalizer,
  MIDDLEWARE.inputOutputLogger,
  MIDDLEWARE.validationErrorHandler,
  MIDDLEWARE.validator
]
