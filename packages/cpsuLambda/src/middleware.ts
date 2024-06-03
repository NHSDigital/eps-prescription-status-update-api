import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import {Logger} from "@aws-lambda-powertools/logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"

export type MiddlewareGenerator = (logger: Logger, schema?: object) => middy.MiddlewareObj

const MIDDLEWARE: Record<string, MiddlewareGenerator> = {
  injectLambdaContext: (logger) => injectLambdaContext(logger, {clearState: true}),
  httpHeaderNormalizer: () => httpHeaderNormalizer() as middy.MiddlewareObj,
  inputOutputLogger: (logger) =>
    inputOutputLogger({
      logger: (request) => {
        if (request.response) {
          logger.debug(request)
        } else {
          logger.info(request)
        }
      }
    }),
  errorHandler: (logger) => errorHandler({logger: logger}),
  validator: (logger, schema) => validator({eventSchema: transpileSchema(schema as object)})
}

export const DEFAULT_HANDLER_MIDDLEWARE = [
  MIDDLEWARE.injectLambdaContext,
  MIDDLEWARE.httpHeaderNormalizer,
  MIDDLEWARE.inputOutputLogger,
  MIDDLEWARE.validator
]
