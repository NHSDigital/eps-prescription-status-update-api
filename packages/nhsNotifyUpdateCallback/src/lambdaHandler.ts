import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"

import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {MessageStatusResponse} from "./types"
import {checkSignature, response, updateNotificationsTable} from "./helpers"

export const logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"],
    "x-request-id": event.headers["x-request-id"] ?? "x-request-id-not-given"
  })
  logger.info("Lambda called with this event", {event})

  // Require a request ID
  if (!event.headers["x-request-id"]) return response(400, {message: "No x-request-id given"})

  // Check the request signature
  const isErr = checkSignature(logger, event)
  if (isErr) return isErr
  logger.info("Signature OK!")

  // Parse out the request body
  if (!event.body) return response(400, {message: "No request body given"})
  let payload: MessageStatusResponse
  try {
    payload = JSON.parse(event.body)
    logger.info("Payload parsed", {payload})
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

  // All's well that ends well
  return {
    statusCode: 202,
    body: "OK"
  }
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
