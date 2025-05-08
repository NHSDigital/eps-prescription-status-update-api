import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"

import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {createHmac} from "crypto"
import {MessageStatusResponse} from "./types"

export const logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})

const APP_NAME = process.env.APP_NAME ?? "NO-APP-NAME"
const API_KEY = process.env.API_KEY ?? "NO-API-KEY"

function response(statusCode: number, body: unknown = {}) {
  return {
    statusCode,
    body: JSON.stringify(body)
  }
}

/**
 * Checks the incoming NHS Notify request signature.
 * If it's okay, returns undefined.
 * If it's not okay, it returns the error response object.
 */
function checkSignature(event: APIGatewayProxyEvent) {
  const signature = event.headers["x-hmac-sha256-signature"]
  if (!signature) return response(401)

  const givenApiKey = event.headers["x-api-key"]
  if (!givenApiKey) return response(401)

  const secretValue = `${APP_NAME}.${API_KEY}`

  // Compute the HMAC-SHA256 hash of the combination of the request body and the secret value
  const payload = event.body ?? ""
  const expectedSignature = createHmac("sha256", secretValue)
    .update(payload, "utf8")
    .digest("hex")

  const givenSignature = event.headers["x-hmac-sha256-signature"]
  if (givenSignature !== expectedSignature) return response(403)

  return undefined
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"],
    "x-request-id": event.headers["x-request-id"] ?? "x-request-id-not-given"
  })
  logger.info("Lambda called with this event", {event})

  // Require a request ID
  if (!event.headers["x-request-id"]) return response(401)

  // Check the request signature
  const isErr = checkSignature(event)
  if (isErr) return isErr

  if (!event.body) return response(401)
  try {
    const payload: MessageStatusResponse = JSON.parse(event.body)
    logger.info("Payload parsed", {payload})
  } catch (error) {
    logger.error("Failed to parse payload", {error, payload: event.body})
  }

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
