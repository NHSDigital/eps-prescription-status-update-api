/* eslint-disable @typescript-eslint/no-explicit-any */
import {MiddlewareObj} from "@middy/core"
import {Logger} from "@aws-lambda-powertools/logger"

// eslint-disable-next-line no-undef
type HandlerLogger = Console | Logger;
type LoggerAndLevel = {
  logger: HandlerLogger;
  level?: string;
};

// custom middy error handler to handle validation errors
function validationErrorHandler({
  logger = console,
  level = "error"
}: LoggerAndLevel) {
  return {
    onError: async (handler) => {
      const setErrorResponse = (body: any) => {
        handler.response = {
          statusCode: 400,
          body: JSON.stringify(JSON.stringify(body)),
          headers: handler.event.headers
        }
      }

      const error: any = handler.error

      if (!error?.cause?.data) {
        logger[level as keyof HandlerLogger]("Validation error", error)
        setErrorResponse([{error: error.message}])
        return
      }

      const errors = error.cause.data.map(parseError)

      logger[level as keyof HandlerLogger]("Validation error", errors)
      setErrorResponse(errors)
    }
  } satisfies MiddlewareObj<any, any, Error, any>
}

type ValidationError = {
  path: string;
  error: string;
};
function parseError(error: any): ValidationError {
  return {
    path: error.instancePath,
    error: error.message
  }
}

export {validationErrorHandler}
