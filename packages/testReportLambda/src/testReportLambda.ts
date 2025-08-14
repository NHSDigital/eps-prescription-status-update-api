/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {TestReportRequestBody, LogSearchOptions} from "./utils/types"
import {searchLogGroupForStrings} from "./utils/logSearching"

export const logger = new Logger({serviceName: "generateTestReport"})

const PSU_LOG_GROUP_NAME = "/aws/lambda/psu-pr-2036-UpdatePrescriptionStatus"

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
    "nhsd-request-id": event.headers["nhsd-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"],
    "x-request-id": event.headers["x-request-id"]
  })

  if (!event.body) {
    return response(400, {"message": "Missing request body."})
  }

  let requestBody: TestReportRequestBody
  try {
    requestBody = JSON.parse(event.body)
  } catch (err) {
    return response(400, {"message": "Badly formed request body", "error": err})
  }
  logger.info("Received request body", {requestBody})

  const searchOptions: LogSearchOptions = {}
  const logEvents = await searchLogGroupForStrings(
    PSU_LOG_GROUP_NAME,
    requestBody.prescriptionIds,
    logger,
    searchOptions
  )

  const foundMessages = logEvents.map(function (events, i) {
    return [events, requestBody.prescriptionIds[i]]
  })
  logger.info(
    "Found matching events",
    {
      "logEvents": foundMessages
    }
  )

  return response(200, {"message": "OK", "searchResults": foundMessages})
}

function response(statusCode: number, body: any) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    }
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
