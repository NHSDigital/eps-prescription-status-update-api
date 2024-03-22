/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {Bundle, BundleEntry, Task} from "fhir/r4"
import {validateTask} from "./requestContentValidation"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})
const tableName = process.env.TABLE_NAME

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
  const xRequestId = event.headers["x-request-id"]

  const responseBundle: Bundle = {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: []
  }

  const requestBody = parseEventBody(event, responseBundle)
  if(!requestBody) {
    logger.error("Unable to parse event body as json.")
    return {
      statusCode: 400,
      body: JSON.stringify(responseBundle),
      headers: {
        "Content-Type": "application/fhir+json",
        "Cache-Control": "no-cache"
      }
    }
  }

  const entries: Array<BundleEntry> = requestBody.entry || []

  const entriesValid = validateEntries(entries, responseBundle)
  if (!entriesValid) {
    logger.error("Content validation issues present in request.")
    return {
      statusCode: 400,
      body: JSON.stringify(responseBundle)
    }
  }

  const {dataItemsValid, dataItems} = buildDataItems(entries, responseBundle, xRequestId)
  if (!dataItemsValid) {
    logger.error("Unable to create valid data items from request.")
    return {
      statusCode: 400,
      body: JSON.stringify(responseBundle)
    }
  }

  for (const dataItem of dataItems) {
    const item = marshall(dataItem)
    logger.info("Marshalled item", {item: item})

    try {
      const command = new PutItemCommand({
        TableName: tableName,
        Item: item
      })
      logger.info("Sending PutItemCommand", {command: command})
      await client.send(command)
    } catch (error) {
      logger.error("Error sending PutItemCommand", {error: error})
      const entry: BundleEntry = {
        fullUrl: dataItem.TaskID,
        response: {
          status: "500 Internal Server Error",
          outcome: {
            resourceType: "OperationOutcome",
            issue: [
              {
                code: "exception",
                severity: "fatal",
                details: {
                  coding: [
                    {
                      system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                      code: "SERVER_ERROR",
                      display: "500: The Server has encountered an error processing the request."
                    }
                  ]
                }
              }
            ]
          }
        }
      }
      replaceResponseBundleEntry(responseBundle, entry)
      continue
    }

    const entry: BundleEntry = {
      fullUrl: dataItem.TaskID,
      response: {
        status: "201 Created",
        outcome: {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "information",
              code: "success",
              diagnostics: "No issues detected during validation"
            }
          ]
        }
      }
    }
    logger.info("Task response", {taskResponse: entry})
    replaceResponseBundleEntry(responseBundle, entry)
  }

  if (entries.length === 0) {
    logger.info("No entries to process")
    return {
      statusCode: 200,
      body: JSON.stringify(responseBundle)
    }
  }

  logger.info("Request audit log", {requestBody: requestBody})
  return {
    statusCode: 201,
    body: JSON.stringify(responseBundle)
  }
}

function parseEventBody(event: APIGatewayProxyEvent, responseBundle: Bundle): Bundle | undefined {
  try {
    return JSON.parse(event.body || "") as Bundle
  } catch (jsonParseError) {
    logger.error("Error parsing request body as json.", {error: jsonParseError})
    const entry: BundleEntry = {
      response: {
        status: "400 Bad Request",
        outcome: {
          resourceType: "OperationOutcome",
          issue: [
            {
              code: "value",
              severity: "error",
              details: {
                coding: [
                  {
                    system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                    code: "BAD_REQUEST",
                    display: "400: The Server was unable to process the request."
                  }
                ]
              }
            }
          ]
        }
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
          outcome: {
            resourceType: "OperationOutcome",
            issue: [
              {
                severity: "information",
                code: "success",
                diagnostics: "No issues detected during validation"
              }
            ]
          }
        }
      }
    } else {
      logger.info("Task failed validation.", {task: task, id: task.id})
      valid = false
      responseEntry = {
        fullUrl: task.id,
        response: {
          status: "400 Bad Request",
          outcome: {
            resourceType: "OperationOutcome",
            issue: [
              {
                code: "value",
                severity: "error",
                details: {
                  coding: [
                    {
                      system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                      code: "BAD_REQUEST",
                      display: `Validation issues: ${validationOutcome.issues}`
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
    responseBundle.entry!.push(responseEntry)
  }
  return valid
}

function buildDataItems(
  entries: Array<BundleEntry>, responseBundle: Bundle, xRequestId: string | undefined
): {dataItemsValid: boolean, dataItems: Array<DataItem>} {
  let valid = true
  const dataItems: Array<DataItem> = []

  for (const entry of entries) {
    const task = entry.resource as Task
    logger.info("Processing Task", {task: task, id: task.id})

    const dataItem: DataItem = {
      RequestID: xRequestId,
      PrescriptionID: task.basedOn?.[0]?.identifier?.value,
      PatientNHSNumber: task.for?.identifier?.value,
      PharmacyODSCode: task.owner?.identifier?.value,
      TaskID: task.id,
      LineItemID: task.focus?.identifier?.value,
      TerminalStatus: task.status,
      RequestMessage: task
    }

    const invalidFields = []
    for (const [field, value] of Object.entries(dataItem)) {
      if (!value) {
        logger.info("Invalid value", {field: field, value: value})
        invalidFields.push(field)
      }
    }

    if (invalidFields.length > 0) {
      const errorMessage = `400: Missing required fields: ${invalidFields.join(", ")}`
      logger.error("Error message", {errorMessage: errorMessage})

      const entry: BundleEntry = {
        fullUrl: task.id,
        response: {
          status: "400 Bad Request",
          outcome: {
            resourceType: "OperationOutcome",
            issue: [
              {
                code: "value",
                severity: "error",
                details: {
                  coding: [
                    {
                      system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                      code: "BAD_REQUEST",
                      display: errorMessage
                    }
                  ]
                }
              }
            ]
          }
        }
      }
      valid = false
      replaceResponseBundleEntry(responseBundle, entry)
    }
    dataItems.push(dataItem)
  }
  return {dataItemsValid: valid, dataItems: dataItems}
}

function replaceResponseBundleEntry(responseBundle: Bundle, entry: BundleEntry) {
  responseBundle.entry!.forEach((e, i) => {
    if (e.fullUrl === entry.fullUrl) {
      responseBundle.entry![i] = entry
    }
  })
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
