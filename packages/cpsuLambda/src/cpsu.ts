import {Logger} from "@aws-lambda-powertools/logger"
import {DEFAULT_HANDLER_MIDDLEWARE} from "./middleware"
import {HandlerParams, newHandler} from "./handler"
import {format_1} from "./schema"
import {LogLevel} from "@aws-lambda-powertools/logger/types"

const LOG_LEVEL = process.env.LOG_LEVEL as LogLevel

export const FORMAT_1_PARAMS: HandlerParams<format_1.eventType, format_1.requestType> = {
  validator: format_1.validator,
  transformer: format_1.transformer
}

console.log(format_1, "££££££££££££")
export const format_1_handler = newHandler({
  params: FORMAT_1_PARAMS,
  middleware: DEFAULT_HANDLER_MIDDLEWARE,
  logger: new Logger({serviceName: "cpsu_format_1Lambda", logLevel: LOG_LEVEL}),
  schema: format_1.eventSchema
})
