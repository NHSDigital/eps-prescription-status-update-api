/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy, {MiddlewareObj} from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {persistDataItems} from "./utils/databaseClient"
import {jobWithTimeout, hasTimedOut} from "./utils/timeoutUtils"
import {validateEntry} from "./validation/content"
import {
  accepted,
  badRequest,
  badRequestOutcome,
  bundleWrap,
  conflictDuplicate,
  createSuccessResponseEntries,
  serverError,
  timeoutResponse
} from "./utils/responses"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
import {
  eventSchema,
  bundleSchema,
  bundleEntryType,
  bundleType,
  taskType
} from "./schema/request"
import {bundleEntryType as responseBundleEntryType} from "./schema/response"

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

export type EventWithHeaders = {
  headers: {
    "nhsd-correlation-id"?: string
    "nhsd-request-id"?: string
    "x-correlation-id"?: string
    "x-request-id"?: string
    "apigw-request-id"?: string
    "attribute-name"?: string
  }
  body: bundleType
}

const lambdaHandler = async (event: EventWithHeaders): Promise<APIGatewayProxyResult> => {
  logger.appendKeys({
    "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
    "nhsd-request-id": event.headers["nhsd-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.headers["apigw-request-id"]
  })
  let responseEntries: Array<responseBundleEntryType> = []

  const xRequestID = getXRequestID(event, responseEntries)
  const applicationName = event.headers["attribute-name"] ?? "unknown"

  if (!xRequestID) {
    return response(400, responseEntries)
  }
  logger.appendKeys({
    "x-request-id": xRequestID
  })

  const requestBundle = event.body

  const requestEntries = requestBundle.entry || []
  const requestTasks = requestEntries.map((entry) => entry.resource)

  if (requestEntries.length === 0) {
    logger.info("No entries to process.")
    return response(200, responseEntries)
  }
  const entriesValid = validateEntries(requestEntries, responseEntries)
  if (!entriesValid) {
    return response(400, responseEntries)
  }

  const dataItems = buildDataItems(requestTasks, xRequestID, applicationName)

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

export function getXRequestID(
  event: EventWithHeaders,
  responseEntries: Array<responseBundleEntryType>
): string | undefined {
  const xRequestID = event.headers["x-request-id"]
  if (!xRequestID) {
    const errorMessage = "Missing or empty x-request-id header."
    logger.error(errorMessage)
    const entry = badRequest([errorMessage])
    responseEntries.push(entry)
    return undefined
  }
  return xRequestID
}

export function validateEntries(
  requestEntries: Array<bundleEntryType>,
  responseEntries: Array<responseBundleEntryType>
): boolean {
  let valid = true
  for (const entry of requestEntries) {
    const validationOutcome = validateEntry(entry)
    if (validationOutcome.valid) {
      logger.info("Entry validated successfully.", {entry: entry, id: entry.fullUrl})
      responseEntries.push(accepted(entry.fullUrl))
    } else {
      const errorMessages = validationOutcome.issues
      logger.info(`Entry failed validation. ${errorMessages.join(", ")}`, {entry: entry, id: entry.fullUrl})
      valid = false
      responseEntries.push(badRequest(errorMessages, entry.fullUrl))
    }
  }
  return valid
}

export function handleTransactionCancelledException(
  e: TransactionCanceledException,
  responseEntries: Array<responseBundleEntryType>
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
  requestTasks: Array<taskType>,
  xRequestID: string,
  applicationName: string
): Array<DataItem> {
  const dataItems: Array<DataItem> = []

  for (const task of requestTasks) {
    logger.info("Building data item for task.", {task: task, id: task.id})

    const repeatNo = task.input?.[0]?.valueInteger

    const dataItem: DataItem = {
      LastModified: task.lastModified,
      LineItemID: task.focus.identifier.value.toUpperCase(),
      PatientNHSNumber: task.for.identifier.value,
      PharmacyODSCode: task.owner.identifier.value.toUpperCase(),
      PrescriptionID: task.basedOn[0].identifier.value.toUpperCase(),
      ...(repeatNo !== undefined && {RepeatNo: repeatNo}),
      RequestID: xRequestID,
      Status: task.businessStatus.coding[0].code,
      TaskID: task.id,
      TerminalStatus: task.status,
      ApplicationName: applicationName
    }

    dataItems.push(dataItem)
  }
  return dataItems
}

function response(statusCode: number, responseEntries: Array<responseBundleEntryType>) {
  return {
    statusCode: statusCode,
    body: JSON.stringify(bundleWrap(responseEntries)),
    headers: {
      "Content-Type": "application/fhir+json",
      "Cache-Control": "no-cache"
    }
  }
}

type HandlerLogger = Console | Logger
type LoggerAndLevel = {
  logger: HandlerLogger
  level?: keyof HandlerLogger
}

type ValidationErrorCause = {
  data: Array<ValidationError>
}

type ValidationError = {
  instancePath: string
  message: string
}

function isValidationErrorCause(cause: any): cause is ValidationErrorCause {
  return cause.package === "@middy/validator" && Array.isArray(cause?.data)
}

function validationErrorHandler({
  logger = console,
  level = "error"
}: LoggerAndLevel): MiddlewareObj<any, any, Error, any> {
  return {
    onError: async (handler) => {
      const error = handler.error

      if (!isValidationErrorCause(error?.cause)) {
        return // let the default error handler deal with this
      }

      const errors = error.cause.data.map((error) => `${error.instancePath}: ${error.message}`)

      logger[level]("Validation errors", error)

      const responseBody = {
        statusCode: 400,
        body: JSON.stringify(badRequestOutcome(errors))
      }

      handler.response = responseBody
    }
  }
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(validator({eventSchema: transpileSchema(eventSchema)}))
  .use(validationErrorHandler({logger: logger}))
  .use(httpHeaderNormalizer())
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(errorHandler({logger: logger}))

export {bundleSchema}
