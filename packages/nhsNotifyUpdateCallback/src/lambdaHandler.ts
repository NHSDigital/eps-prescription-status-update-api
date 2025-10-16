import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"

import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {CallbackType, CallbackResponse} from "./types"
import {checkSignature, response, updateNotificationsTable} from "./helpers"

export const logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "apigw-request-id": event.headers["apigw-request-id"],
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"]
  })

  // Validate the request
  const isErr = await checkSignature(logger, event)
  if (isErr) return isErr
  if (!event.body) return response(400, {message: "No request body given"})

  // Parse out the request body
  let payload: CallbackResponse
  try {
    payload = JSON.parse(event.body)
  } catch (error) {
    logger.error("Failed to parse payload", {error, payload: event.body})
    return response(400, {message: "Request body failed to parse"})
  }

  try {
    await updateNotificationsTable(logger, payload)
  } catch (error) {
    logger.info("Failed to push updates to the notification state table", {error})
    return response(500, {message: "Failed to update the notification state table"})
  }

  for (const m of payload.data) {
    logger.info("Processed callback data item", {data: m.type})
    if ((m.type !== CallbackType.message) && (m.type !== CallbackType.channel)) {
      logger.warn("Unknown callback data structure. Returning 400 despite possible partial success.", {data: m})
      // all db work done, so return early at first unsupported msg type
      return response(
        400,
        {
          message: (
            "Received an unknown callback data type. expected data[].type"
            + " to always be either ChannelStatus or MessageStatus"
          )
        }
      )
    }
  }

  // All's well that ends well
  return response(202)
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(httpHeaderNormalizer())
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(errorHandler({logger: logger}))
