import {Logger} from "@aws-lambda-powertools/logger"
import {DEFAULT_HANDLER_MIDDLEWARE} from "./middleware"
import {HandlerParams, newHandler} from "./handler"
import {format_1} from "./schema"

const FORMAT_1_PARAMS: HandlerParams<format_1.eventType, format_1.requestType> = {
  validator: format_1.validator,
  transformer: format_1.transformer
}
export const format_1_handler = newHandler({
  params: FORMAT_1_PARAMS,
  middleware: DEFAULT_HANDLER_MIDDLEWARE,
  logger: new Logger({serviceName: "cpsu_format_1Lambda"}),
  schema: format_1.eventSchema
})
