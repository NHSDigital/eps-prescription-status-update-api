import {APIGatewayProxyResult} from "aws-lambda"
import middy from "@middy/core"
import {MiddlewareGenerator} from "./middleware"
import {Logger} from "@aws-lambda-powertools/logger"
import {Result} from "pratica"
import {Bundle, Task} from "fhir/r4"

export type Validator<Event, Message> = (event: Event) => Result<Message, APIGatewayProxyResult>
export type Transformer<Message> = (requestBody: Message) => Result<Bundle<Task>, APIGatewayProxyResult>

type EventWithHeaders = {
  headers: Record<string, unknown>
}
type HandlerConfig<Event extends EventWithHeaders, Message> = {
  middleware: Array<MiddlewareGenerator>
  params: HandlerParams<Event, Message>
  logger: Logger
  schema?: object
}

export type HandlerParams<Event extends EventWithHeaders, Message> = {
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
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"] as string,
    "nhsd-request-id": event.headers["nhsd-request-id"] as string,
    "x-correlation-id": event.headers["x-correlation-id"] as string,
    "apigw-request-id": event.headers["apigw-request-id"] as string
  })

  return params
    .validator(event)
    .chain(params.transformer)
    .map((bundle) => {
      return {
        statusCode: 200,
        body: JSON.stringify(bundle)
      }
    })
    .value()
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
