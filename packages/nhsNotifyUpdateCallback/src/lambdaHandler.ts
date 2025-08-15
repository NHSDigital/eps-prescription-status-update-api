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
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"],
    "x-request-id": event.headers["x-request-id"]
  })

  // Require a request ID
  if (!event.headers["x-request-id"]) return response(400, {message: "No x-request-id given"})

  // Check the request signature
  const isErr = await checkSignature(logger, event)
  if (isErr) return isErr

  // Parse out the request body
  if (!event.body) return response(400, {message: "No request body given"})
  let payload: CallbackResponse
  try {
    payload = JSON.parse(event.body)
  } catch (error) {
    logger.error("Failed to parse payload", {error, payload: event.body})
    return response(400, {message: "Request body failed to parse"})
  }

  let receivedUnknownCallbackType = false
  payload.data.forEach(m => {
    let logPayload = {}
    if (m.type === CallbackType.message) {
      logPayload = {
        callbackType: m.type,
        messageStatus: m.attributes.messageStatus,
        messageReference: m.attributes.messageReference,
        messageId: m.attributes.messageId,
        receivedTimestamp: m.attributes.timestamp
      }

    } else if (m.type === CallbackType.channel) {
      logPayload = {
        callbackType: m.type,
        messageStatus: m.attributes.channelStatus,
        supplierStatus: m.attributes.supplierStatus ?? "not given",
        retryCount: m.attributes.retryCount,
        messageReference: m.attributes.messageReference,
        messageId: m.attributes.messageId,
        receivedTimestamp: m.attributes.timestamp
      }
    } else {
      logger.warn("Unknown callback data structure.", {data: m})
      receivedUnknownCallbackType = true
    }
    logger.info(
      "Message state updated",
      logPayload
    )
  })

  try {
    await updateNotificationsTable(logger, payload)
  } catch (error) {
    logger.info("Failed to push updates to the notification state table", {error})
    return response(500, {message: "Failed to update the notification state table"})
  }

  if (receivedUnknownCallbackType) {
    logger.info(
      "Detected some unknown callback types. Returning 400 despite possible partial success."
    )
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

  // All's well that ends well
  return response(202, "OK")
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
