/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {TestReportRequestBody, TestReportResponseBody} from "./utils/types"
import {getItemsForPrescriptionIDs} from "./utils/dynamo"

export const logger = new Logger({serviceName: "generateTestReport"})

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
    "nhsd-request-id": event.headers["nhsd-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"],
    "x-request-id": event.headers["x-request-id"]
  })

  if (!event.body) {
    return response(400, {message: "Missing request body."})
  }

  let requestBody: TestReportRequestBody
  try {
    requestBody = JSON.parse(event.body)
  } catch (err) {
    return response(400, {message: "Badly formed request body", error: err})
  }
  logger.info("Received request body", {requestBody})

  const applicationName = event.headers["attribute-name"] ?? "unknown"
  if (requestBody.connectingSystemName !== applicationName) {
    logger.error(
      "Mismatch between header application name, and request body connecting system name.",
      {
        bodyConnectingSystemName: requestBody.connectingSystemName,
        applicationName
      }
    )

    // In non-int environments, complain about mismatches but continue anyway.
    // In int though, return an error.
    if (process.env.ENVIRONMENT?.toLowerCase() === "int") {
      return response(
        400,
        {
          message: "Mismatch between header application name, and request body connecting system name.",
          bodyConnectingSystemName: requestBody.connectingSystemName,
          applicationName
        }
      )
    }
  }

  const updateRecords = await getItemsForPrescriptionIDs(
    requestBody.connectingSystemName,
    requestBody.prescriptionIds,
    logger
  )
  logger.info("Found matching events", {updateRecords})

  // Get the earliest and latest status update timestamps from LastModified fields
  const firstStatusDate = "todo"
  const lastStatusDate = "todo"

  const responseBody: TestReportResponseBody = {
    systemName: requestBody.connectingSystemName,
    firstStatusDate,
    lastStatusDate,
    statusUpdates: updateRecords.map((el) => {
      return {
        prescriptionId: el.prescriptionId,
        statusDataArray: el.PSUDataItems.map((ell) => {
          return {
            status: ell.Status,
            timestamp: ell.LastModified,
            isSuccess: "success"
          }
        })
      }
    })
  }

  return response(200, responseBody)
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
