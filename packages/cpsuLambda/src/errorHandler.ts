/* eslint-disable @typescript-eslint/no-explicit-any */
import {MiddlewareObj} from "@middy/core"
import {Logger} from "@aws-lambda-powertools/logger"

type HandlerLogger = Console | Logger
type LoggerAndLevel = {
  logger: HandlerLogger
  level?: string
}

// custom middy error handler to handle valiation errors

function validationErrorHandler({logger = console, level = "error"}: LoggerAndLevel) {
  return {
    onError: async (handler) => {
      const error: any = handler.error

      if (!error?.cause?.data) {
        logger[level as keyof HandlerLogger]("Validation error", error)
        handler.response = {
          statusCode: 400,
          body: JSON.stringify([{error: error.message}])
        }
        return
      }

      const errors = error.cause.data.map(parseError)

      logger[level as keyof HandlerLogger]("Validation error", errors)

      const responseBody = {
        statusCode: 400,
        body: JSON.stringify(errors)
      }

      handler.response = responseBody
    }
  } satisfies MiddlewareObj<any, any, Error, any>
}

type ValidationError = {
  path: string
  error: string
}
function parseError(error: any): ValidationError {
  return {
    path: error.instancePath,
    error: error.message
  }
}

export {validationErrorHandler}
