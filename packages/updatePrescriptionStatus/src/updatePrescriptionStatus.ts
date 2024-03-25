/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {BatchWriteItemCommand, DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {Bundle, BundleEntry, Task} from "fhir/r4"

import {validateTask} from "./requestContentValidation"
import {
  accepted,
  badRequest,
  createSuccessResponseBundle,
  serverError
} from "./utils/responses"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})
const tableName = process.env.TABLE_NAME || "PrescriptionStatusUpdates"

interface DataItem {
  RequestID?: string;
  PrescriptionID?: string;
  PatientNHSNumber?: string;
  PharmacyODSCode?: string;
  TaskID?: string;
  LineItemID?: string;
  TerminalStatus: string;
  RequestMessage: any;
}

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const responseBundle: Bundle = {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: []
  }

  const xRequestID = event.headers["x-request-id"] || undefined
  if (!xRequestID) {
    const errorMessage = "Missing x-request-id header."
    logger.error(errorMessage)
    const entry: BundleEntry = {
      response: {
        status: "400 Bad Request",
        outcome: badRequest(errorMessage)
      }
    }
    responseBundle.entry!.push(entry)
    return response(400, JSON.stringify(responseBundle))
  }

  const requestBody = parseEventBody(event, responseBundle)
  if(!requestBody) {
    logger.error("Unable to parse event body as json.")
    return response(400, JSON.stringify(responseBundle))
  }
  logger.info("Request audit log", {requestBody: requestBody})

  const entries: Array<BundleEntry> = requestBody.entry || []

  if (entries.length === 0) {
    logger.info("No entries to process.")
    return response(200, JSON.stringify(responseBundle))
  }

  const entriesValid = validateEntries(entries, responseBundle)
  if (!entriesValid) {
    logger.error("Content validation issues present in request.")
    return response(400, JSON.stringify(responseBundle))
  }

  const dataItems = buildDataItems(entries, responseBundle, xRequestID)
  const batchCommand = createBatchCommand(dataItems)

  const persistSuccess = await persistDataItems(batchCommand, responseBundle)
  if (!persistSuccess) {
    return response(500, JSON.stringify(responseBundle))
  }

  createSuccessResponseBundle(responseBundle, entries)
  logger.info("Event processed successfully.")
  return response(201, JSON.stringify(responseBundle))
}

function parseEventBody(event: APIGatewayProxyEvent, responseBundle: Bundle): Bundle | undefined {
  try {
    return JSON.parse(event.body || "") as Bundle
  } catch (jsonParseError) {
    const errorMessage = "Error parsing request body as json."
    logger.error(errorMessage, {error: jsonParseError})
    const entry: BundleEntry = {
      response: {
        status: "400 Bad Request",
        outcome: badRequest(errorMessage)
      }
    }
    responseBundle.entry!.push(entry)
  }
}

function validateEntries(entries: Array<BundleEntry>, responseBundle: Bundle): boolean {
  let valid = true
  for (const requestEntry of entries) {
    const task = requestEntry.resource as Task
    logger.info("Validating task.", {task: task, id: task.id})

    const validationOutcome = validateTask(task)

    let responseEntry: BundleEntry
    if (validationOutcome.valid) {
      logger.info("Task validated successfully.", {task: task, id: task.id})
      responseEntry = {
        fullUrl: task.id,
        response: {
          status: "200 Accepted",
          outcome: accepted()
        }
      }
    } else {
      const errorMessage = `Validation issues: ${validationOutcome.issues}`
      logger.info(`Task failed validation. ${errorMessage}`, {task: task, id: task.id})
      valid = false
      responseEntry = {
        fullUrl: task.id,
        response: {
          status: "400 Bad Request",
          outcome: badRequest(errorMessage)
        }
      }
    }
    responseBundle.entry!.push(responseEntry)
  }
  return valid
}

function buildDataItems(
  entries: Array<BundleEntry>, responseBundle: Bundle, xRequestID: string | undefined
): Array<DataItem> {
  const dataItems: Array<DataItem> = []

  for (const entry of entries) {
    const task = entry.resource as Task
    logger.info("Processing Task", {task: task, id: task.id})

    const dataItem: DataItem = {
      RequestID: xRequestID,
      PrescriptionID: task.basedOn?.[0]?.identifier?.value,
      PatientNHSNumber: task.for?.identifier?.value,
      PharmacyODSCode: task.owner?.identifier?.value,
      TaskID: task.id,
      LineItemID: task.focus?.identifier?.value,
      TerminalStatus: task.status,
      RequestMessage: task
    }

    dataItems.push(dataItem)
  }
  return dataItems
}

function createBatchCommand(dataItems: Array<DataItem>): BatchWriteItemCommand {
  const putRequests = dataItems.map(d => {
    return {
      PutRequest: {
        Item: marshall(d)
      }
    }
  })
  return new BatchWriteItemCommand({
    RequestItems: {
      [tableName]: putRequests
    }
  })
}

async function persistDataItems(batchCommand: BatchWriteItemCommand, responseBundle: Bundle): Promise<boolean> {
  try {
    logger.info("Sending BatchWriteItemCommand to DynamoDB", {command: batchCommand})
    await client.send(batchCommand)
    logger.info("BatchWriteItemCommand sent to DynamoDB successfully.", {command: batchCommand})
    return true
  } catch(e) {
    logger.error("Error sending BatchWriteItemCommand to DynamoDB.", {error: e})
    responseBundle.entry = [{
      response: {
        status: "500 Internal Server Error",
        outcome: serverError()
      }
    }]
    return false
  }
}

function response(statusCode: number, body: string) {
  return {
    statusCode: statusCode,
    body: body,
    headers: {
      "Content-Type": "application/fhir+json",
      "Cache-Control": "no-cache"
    }
  }
}

export const handler = middy(lambdaHandler)
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
