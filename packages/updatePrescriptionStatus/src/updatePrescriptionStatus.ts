/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import {Bundle, BundleEntry, Task} from "fhir/r4"
import {persistDataItems} from "./utils/databaseClient"
import {jobWithTimeout, hasTimedOut} from "./utils/timeoutUtils"
import {transactionBundle, validateEntry} from "./validation/content"
import {
  accepted,
  badRequest,
  bundleWrap,
  conflictDuplicate,
  createSuccessResponseEntries,
  serverError,
  timeoutResponse
} from "./utils/responses"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"

const LAMBDA_TIMEOUT_MS = 9500
const logger = new Logger({serviceName: "updatePrescriptionStatus"})

export interface DataItem {
  LastModified: string
  LineItemID: string
  PatientNHSNumber: string
  PharmacyODSCode: string
  PrescriptionID: string
  RepeatNo?: number
  RequestID: string
  Status: string
  TaskID: string
  TerminalStatus: string
  ApplicationName: string
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
    "nhsd-request-id": event.headers["nhsd-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"]
  })
  let responseEntries: Array<BundleEntry> = []

  const xRequestID = getXRequestID(event, responseEntries)
  const applicationName = event.headers["attribute-name"] ?? "unknown"

  if (!xRequestID) {
    return response(400, responseEntries)
  }
  logger.appendKeys({
    "x-request-id": xRequestID
  })

  const requestBody = event.body
  const requestBundle = castEventBody(requestBody, responseEntries)
  if (!requestBundle) {
    return response(400, responseEntries)
  }

  const requestEntries: Array<BundleEntry> = requestBundle.entry || []

  if (requestEntries.length === 0) {
    logger.info("No entries to process.")
    return response(200, responseEntries)
  }
  const entriesValid = validateEntries(requestEntries, responseEntries)
  if (!entriesValid) {
    return response(400, responseEntries)
  }

  const dataItems = buildDataItems(requestEntries, xRequestID, applicationName)

  try {
    const persistSuccess = persistDataItems(dataItems, logger)
    const persistResponse = await jobWithTimeout(LAMBDA_TIMEOUT_MS, persistSuccess)

    if (hasTimedOut(persistResponse)) {
      responseEntries = [timeoutResponse()]
      logger.info("DynamoDB operation timed out.")
      return response(504, responseEntries)
    }

    if (!persistResponse) {
      responseEntries = [serverError()]
      return response(500, responseEntries)
    }

    responseEntries = createSuccessResponseEntries(requestEntries)
    logger.info("Event processed successfully.")
  } catch (e) {
    if (e instanceof TransactionCanceledException) {
      handleTransactionCancelledException(e, responseEntries)

      return response(409, responseEntries)
    }
  }
  return response(201, responseEntries)
}

export function getXRequestID(event: APIGatewayProxyEvent, responseEntries: Array<BundleEntry>): string | undefined {
  const xRequestID = event.headers["x-request-id"]
  if (!xRequestID) {
    const errorMessage = "Missing or empty x-request-id header."
    logger.error(errorMessage)
    const entry: BundleEntry = badRequest(errorMessage)
    responseEntries.push(entry)
    return undefined
  }
  return xRequestID
}

export function castEventBody(body: any, responseEntries: Array<BundleEntry>): Bundle | undefined {
  if (transactionBundle(body)) {
    return body as Bundle
  } else {
    const errorMessage = "Request body does not have resourceType of 'Bundle' and type of 'transaction'."
    logger.error(errorMessage)
    const entry: BundleEntry = badRequest(errorMessage)
    responseEntries.push(entry)
  }
}

export function validateEntries(requestEntries: Array<BundleEntry>, responseEntries: Array<BundleEntry>): boolean {
  logger.info("Validating entries.")
  let valid = true
  for (const entry of requestEntries) {
    const fullUrl = entry.fullUrl!
    logger.info("Validating entry.", {entry: entry, id: entry.fullUrl})

    const validationOutcome = validateEntry(entry)

    let responseEntry: BundleEntry
    if (validationOutcome.valid) {
      logger.info("Entry validated successfully.", {entry: entry, id: entry.fullUrl})
      responseEntry = accepted(fullUrl)
    } else {
      const errorMessage = validationOutcome.issues!
      logger.info(`Entry failed validation. ${errorMessage}`, {entry: entry, id: entry.fullUrl})
      valid = false
      responseEntry = badRequest(errorMessage, fullUrl)
    }
    responseEntries.push(responseEntry)
  }
  logger.info("Entries validated.")
  return valid
}

export function handleTransactionCancelledException(
  e: TransactionCanceledException,
  responseEntries: Array<BundleEntry>
): void {
  const taskIdSet = new Set<string>()

  e.CancellationReasons?.forEach((reason) => {
    const taskId = reason.Item?.TaskID?.S
    if (taskId) {
      const conflictedEntry = conflictDuplicate(taskId)

      const index = responseEntries.findIndex((entry) => {
        const entryTaskId = entry.response?.location?.split("/").pop() || entry.fullUrl?.split(":").pop()
        return entryTaskId === taskId
      })

      if (index !== -1) {
        responseEntries[index] = conflictedEntry
      } else {
        responseEntries.push(conflictedEntry)
      }

      taskIdSet.add(taskId)
    }
  })

  responseEntries = responseEntries.filter((entry) => {
    const taskId = entry.fullUrl?.split(":").pop()
    return !taskId || !taskIdSet.has(taskId) || entry.response?.status !== "200 OK"
  })
}

export function buildDataItems(
  requestEntries: Array<BundleEntry>,
  xRequestID: string,
  applicationName: string
): Array<DataItem> {
  const dataItems: Array<DataItem> = []

  for (const requestEntry of requestEntries) {
    const task = requestEntry.resource as Task
    logger.info("Building data item for task.", {task: task, id: task.id})

    const repeatNo = task.input?.[0]?.valueInteger

    const dataItem: DataItem = {
      LastModified: task.lastModified!,
      LineItemID: task.focus!.identifier!.value!.toUpperCase(),
      PatientNHSNumber: task.for!.identifier!.value!,
      PharmacyODSCode: task.owner!.identifier!.value!.toUpperCase(),
      PrescriptionID: task.basedOn![0].identifier!.value!.toUpperCase(),
      ...(repeatNo !== undefined && {RepeatNo: repeatNo}),
      RequestID: xRequestID,
      Status: task.businessStatus!.coding![0].code!,
      TaskID: task.id!,
      TerminalStatus: task.status,
      ApplicationName: applicationName
    }

    dataItems.push(dataItem)
  }
  return dataItems
}

function response(statusCode: number, responseEntries: Array<BundleEntry>) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(bundleWrap(responseEntries)),
    headers: {
      "Content-Type": "application/fhir+json",
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
