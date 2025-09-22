/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"

import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"

import errorHandler from "@nhs/fhir-middy-error-handler"

import {
  TestReportRequestBody,
  TestReportResponseBody,
  TestReportPrescriptionPackage,
  TestReportSuccesses,
  TestReportFailures
} from "./utils/types"
import {LogSearchOptions} from "./utils/logSearchTypes"
import {searchLogGroupForPrescriptionIds} from "./utils/logSearching"
import {getItemsForPrescriptionIDs} from "./utils/dynamo"

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
    // In int (which for this, is ""prod""), return an error.
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
  if (updateRecords.length) logger.info("Found matching prescription update records", {updateRecords})

  // Get the earliest and latest status update timestamps from LastModified fields
  const allDates: Array<string> = updateRecords.flatMap(record => record.LastModified)
  const sortedDates = allDates.sort() // sorting iso timestamps alphabetically sorts them in time
  const firstStatusDate = sortedDates.length > 0 ? sortedDates[0] : ""
  const lastStatusDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : ""

  // Search the logs for failed update attempts, and their reasons
  const searchOptions: LogSearchOptions = {}
  const logEvents = await searchLogGroupForPrescriptionIds(
    PSU_LOG_GROUP_NAME,
    requestBody.connectingSystemName,
    requestBody.prescriptionIds,
    logger,
    searchOptions
  )
  if (logEvents.length) logger.info("Found matching events", {logEvents})

  function getReportForPrescriptionID(id: string): TestReportPrescriptionPackage {
    const successes: Array<TestReportSuccesses> = updateRecords
      .filter(record => record.PrescriptionID === id)
      .map(record => {
        return {
          status: record.Status,
          timestamp: record.LastModified
        }
      })

    const failures: Array<TestReportFailures> = logEvents
      .filter(batch => batch.prescriptionId === id)
      .flatMap(batch => {
        return batch.logEvents.map(event => {
          return {
            submittedStatus: event.currentStatus,
            submittedTerminalStatus: event.currentTerminalStatus,
            submittedTimestamp: event.currentTimestamp,
            storedStatus: event.previousStatus,
            storedTerminalStatus: event.previousTerminalStatus,
            storedTimestamp: event.previousTimestamp,
            message: event.message
          }
        })
      })

    return {
      prescriptionID: id,
      successes,
      failures
    }
  }

  const packages: Array<TestReportPrescriptionPackage> = requestBody.prescriptionIds.map(getReportForPrescriptionID)

  const responseBody: TestReportResponseBody = {
    systemName: requestBody.connectingSystemName,
    firstStatusDate,
    lastStatusDate,
    prescriptionIdResults: packages
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
