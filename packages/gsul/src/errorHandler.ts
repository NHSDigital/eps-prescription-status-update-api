/* eslint-disable @typescript-eslint/no-explicit-any */
import {MiddlewareObj} from "@middy/core"
import {Logger} from "@aws-lambda-powertools/logger"
import{responseType} from "./schema/response.ts"

type MockLogger = {
  error: (error: Error, message: string) => void
}
type HandlerLogger = Console | MockLogger | Logger
type LoggerAndLevel = {
  logger?: HandlerLogger
  level?: string
}

// custom middy error handler to just log the error and return isSuccess = false

function errorHandler({logger = console, level = "error"}: LoggerAndLevel) {
  return {
    onError: async (handler) => {
      const error: any = handler.error

      // if there are a `statusCode` and an `error` field
      // this is a valid http error object
      if (typeof logger[level] === "function") {
        logger[level](
          {
            error: ((e) => ({
              name: e.name,
              message: e.message,
              stack: e.stack,
              details: e.details,
              cause: e.cause,
              status: e.status,
              statusCode: e.statusCode,
              expose: e.expose
            }))(error)
          },
          `${error.name}: ${error.message}`
        )
      }

      const responseBody: responseType = {
        schemaVersion: 1,
        isSuccess: false,
        prescriptions: []
      }

      handler.response = responseBody
    }
  } satisfies MiddlewareObj<any, any, Error, any>
}

export {errorHandler}
