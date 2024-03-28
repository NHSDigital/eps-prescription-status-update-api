/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {Bundle, BundleEntry, Task} from "fhir/r4"

import {transactionBundle, validateTask} from "./validation/content"
import {
  accepted,
  badRequest,
  bundleWrap,
  createSuccessResponseEntries,
  serverError
} from "./utils/responses"
import {persistDataItems} from "./utils/databaseClient"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})

interface DataItem {
  LastModified: string
  LineItemID: string
  PatientNHSNumber: string
  PharmacyODSCode: string
  PrescriptionID: string
  RequestID: string
  RequestMessage: Task
  Status: string
  TaskID: string
  TerminalStatus: string
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let responseEntries: Array<BundleEntry> = []

  const xRequestID = getXRequestID(event, responseEntries)
  if (!xRequestID) {
    return response(400, responseEntries)
  }

  const requestBody = event.body
  const requestBundle = castEventBody(requestBody, responseEntries)
  if(!requestBundle) {
    return response(400, responseEntries)
  }
  logger.info("Request audit log", {requestBody: requestBundle})

  const requestEntries: Array<BundleEntry> = requestBundle.entry || []

  if (requestEntries.length === 0) {
    logger.info("No entries to process.")
    return response(200, responseEntries)
  }

  const entriesValid = validateEntries(requestEntries, responseEntries)
  if (!entriesValid) {
    return response(400, responseEntries)
  }

  const dataItems = buildDataItems(requestEntries, xRequestID)

  const persistSuccess = await persistDataItems(dataItems)
  if (!persistSuccess) {
    responseEntries = [serverError()]
    return response(500, responseEntries)
  }

  responseEntries = createSuccessResponseEntries(requestEntries)
  logger.info("Event processed successfully.")
  return response(201, responseEntries)
}

function getXRequestID(event: APIGatewayProxyEvent, responseEntries: Array<BundleEntry>): string | undefined {
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

function castEventBody(body: any, responseEntries: Array<BundleEntry>): Bundle | undefined {
  if (transactionBundle(body)) {
    return body as Bundle
  } else {
    const errorMessage = "Request body does not have resourceType of 'Bundle' and type of 'transaction'."
    logger.error(errorMessage)
    const entry: BundleEntry = badRequest(errorMessage)
    responseEntries.push(entry)
  }
}

function validateEntries(requestEntries: Array<BundleEntry>, responseEntries: Array<BundleEntry>): boolean {
  logger.info("Validating entries.")
  let valid = true
  for (const requestEntry of requestEntries) {
    const task = requestEntry.resource as Task
    logger.info("Validating task.", {task: task, id: task.id})

    const validationOutcome = validateTask(task)

    let responseEntry: BundleEntry
    if (validationOutcome.valid) {
      logger.info("Task validated successfully.", {task: task, id: task.id})
      responseEntry = accepted(task.id!)
    } else {
      const errorMessage = validationOutcome.issues!
      logger.info(`Task failed validation. ${errorMessage}`, {task: task, id: task.id})
      valid = false
      responseEntry = badRequest(errorMessage, task.id)
    }
    responseEntries.push(responseEntry)
  }
  logger.info("Entries validated.")
  return valid
}

function buildDataItems(requestEntries: Array<BundleEntry>, xRequestID: string): Array<DataItem> {
  const dataItems: Array<DataItem> = []

  for (const requestEntry of requestEntries) {
    const task = requestEntry.resource as Task
    logger.info("Building data item for task.", {task: task, id: task.id})

    const dataItem: DataItem = {
      LastModified: task.lastModified!,
      LineItemID: task.focus!.identifier!.value!,
      PatientNHSNumber: task.for!.identifier!.value!,
      PharmacyODSCode: task.owner!.identifier!.value!,
      PrescriptionID: task.basedOn![0]!.identifier!.value!,
      RequestID: xRequestID,
      RequestMessage: task,
      Status: task.businessStatus!.coding![0].code!,
      TaskID: task.id!,
      TerminalStatus: task.status
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

const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        if (request.response) {
          logger.debug(request)
        } else {
          logger.info(request)
        }
      }
    })
  )
  .use(errorHandler({logger: logger}))

export {DataItem, handler, castEventBody, buildDataItems, getXRequestID, persistDataItems, validateEntries}
