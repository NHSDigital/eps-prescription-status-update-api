import {APIGatewayProxyResult} from "aws-lambda"
import middy from "@middy/core"
import {MiddlewareGenerator} from "./middleware"
import {Logger} from "@aws-lambda-powertools/logger"
import {Result} from "pratica"
import {Bundle, Task} from "fhir/r4"
import {wrap_with_status} from "./utils"

export type Validator<Event, Message> = (event: Event, logger: Logger) => Result<Message, APIGatewayProxyResult>
export type Transformer<Message> = (requestBody: Message, logger: Logger) => Result<Bundle<Task>, APIGatewayProxyResult>

type EventWithHeaders = {
  headers: {
    "nhsd-correlation-id"?: string
    "nhsd-request-id"?: string
    "x-correlation-id"?: string
    "apigw-request-id"?: string
  }
}
type HandlerConfig<Event, Message> = {
  middleware: Array<MiddlewareGenerator>
  params: HandlerParams<Event, Message>
  logger: Logger
  schema?: object
}

export type HandlerParams<Event, Message> = {
  validator: Validator<Event, Message>
  transformer: Transformer<Message>
}

/**
 *  Generic handler for all lambda functions.
 *  Validates the incoming event then transforms it into a response.
 */
async function generic_handler<Event extends EventWithHeaders, Message>(
  event: Event,
  params: HandlerParams<Event, Message>,
  logger: Logger
): Promise<APIGatewayProxyResult> {
  append_headers(event.headers, logger)

  const validator = (event: Event) => params.validator(event, logger)
  const transformer = (requestBody: Message) => params.transformer(requestBody, logger)
  return validator(event).chain(transformer).map(wrap_with_status(200, event.headers)).value()
}

function append_headers(headers: Record<string, string>, logger: Logger) {
  const headers_to_append: Record<string, string> = {}
  if (headers["apigw-request-id"]) {
    headers_to_append["apigw-request-id"] = headers["apigw-request-id"]
  }
  if (headers["nhsd-correlation-id"]) {
    headers_to_append["nhsd-correlation-id"] = headers["nhsd-correlation-id"]
  }
  if (headers["nhsd-request-id"]) {
    headers_to_append["nhsd-request-id"] = headers["nhsd-request-id"]
  }
  if (headers["x-correlation-id"]) {
    headers_to_append["x-correlation-id"] = headers["x-correlation-id"]
  }
  logger.appendKeys(headers_to_append)
}

/**
 *  Creates a new Lambda handler with the specified handler function and middleware.
 */
export const newHandler = <Event extends EventWithHeaders, Message>(handlerConfig: HandlerConfig<Event, Message>) => {
  const newHandler = middy((event: Event) => generic_handler(event, handlerConfig.params, handlerConfig.logger))

  for (const middleware_generator of handlerConfig.middleware) {
    newHandler.use(middleware_generator(handlerConfig.logger, handlerConfig.schema))
  }

  return newHandler
}
