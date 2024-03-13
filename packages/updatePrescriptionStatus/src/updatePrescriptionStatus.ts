/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {v4 as uuidv4} from "uuid"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})
const tableName = process.env.TABLE_NAME

interface DynamoDBItem {
  RequestID: string | undefined;
  PrescriptionID: string;
  PatientNHSNumber: string;
  PharmacyODSCode: string;
  TaskID: string;
  LineItemID: string;
  TerminalStatusIndicator: string;
  LastModified: string;
  Timestamp: string;
  RequestMessage: any;
}

const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const xRequestId = event.headers["x-request-id"]
    let requestBody
    try {
      requestBody = JSON.parse(event.body || "")
    } catch (jsonParseError) {
      logger.error("Error parsing JSON", {jsonParseError: jsonParseError})
      const errorResponseBody = {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "value",
            severity: "error",
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/Spine-ErrorOrWarningCode",
                  code: "INVALID_JSON",
                  display: "Invalid JSON format in request body"
                }
              ]
            }
          }
        ]
      }
      return {
        statusCode: 400,
        body: JSON.stringify(errorResponseBody),
        headers: {
          "Content-Type": "application/fhir+json",
          "Cache-Control": "no-cache"
        }
      }
    }

    const entries = requestBody.entry

    if (!entries || entries.length === 0) {
      logger.error("Missing required fields")
      const errorResponseBody = {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "value",
            severity: "error",
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/Spine-ErrorOrWarningCode",
                  code: "MISSING_VALUE",
                  display: "Missing required fields"
                }
              ]
            }
          }
        ]
      }
      return {
        statusCode: 400,
        body: JSON.stringify(errorResponseBody),
        headers: {
          "Content-Type": "application/fhir+json",
          "Cache-Control": "no-cache"
        }
      }
    }

    const responseBundle: any = {
      resourceType: "Bundle",
      id: uuidv4(),
      meta: {
        lastUpdated: new Date().toISOString()
      },
      type: "transaction-response",
      entry: []
    }

    for (const entry of entries) {
      logger.info("Processing entry", {entry: entry})

      const entry_resource = entry.resource
      logger.info("Processed the entry resource", {processedEntryResource: entry_resource})

      const dynamoDBItem: DynamoDBItem = {
        RequestID: xRequestId,
        PrescriptionID: entry_resource.basedOn?.[0]?.identifier?.value,
        PatientNHSNumber: entry_resource.for?.identifier?.value,
        PharmacyODSCode: entry_resource.owner?.identifier?.value,
        TaskID: entry_resource.id,
        LineItemID: entry_resource.focus?.identifier?.value,
        TerminalStatusIndicator: entry_resource.status,
        LastModified: entry_resource.lastModified,
        Timestamp: new Date().toISOString(),
        RequestMessage: entry_resource
      }

      const invalidFields = []
      for (const [field, value] of Object.entries(dynamoDBItem)) {
        if (!value) {
          logger.info("Invalid value", {field: field, value: value})
          invalidFields.push(field)
        }
      }

      if (invalidFields.length > 0) {
        const errorMessage = `Missing required fields: ${invalidFields.join(", ")}`
        logger.error("Error message", {errorMessage: errorMessage})
        const errorResponseBody = {
          resourceType: "OperationOutcome",
          issue: [
            {
              code: "value",
              severity: "error",
              details: {
                coding: [
                  {
                    system: "https://fhir.nhs.uk/CodeSystem/Spine-ErrorOrWarningCode",
                    code: "MISSING_VALUE",
                    display: errorMessage
                  }
                ]
              }
            }
          ]
        }
        return {
          statusCode: 400,
          body: JSON.stringify(errorResponseBody),
          headers: {
            "Content-Type": "application/fhir+json",
            "Cache-Control": "no-cache"
          }
        }
      }

      const item = marshall(dynamoDBItem)
      logger.info("Marshalled item", {item: item})

      const command = new PutItemCommand({
        TableName: tableName,
        Item: item
      })
      logger.info("Sending PutItemCommand", {command: command})
      await client.send(command)

      const taskResponse = {
        response: {
          status: "201 Created",
          location: `Task/${dynamoDBItem.TaskID}/_history/1`,
          etag: "W/\"1\"",
          lastModified: new Date().toISOString(),
          outcome: {
            resourceType: "OperationOutcome",
            meta: {
              lastUpdated: new Date().toISOString()
            },
            issue: [
              {
                severity: "information",
                code: "informational",
                diagnostics: "No issues detected during validation"
              }
            ]
          }
        }
      }

      logger.info("Task response", {taskResponse: taskResponse})
      responseBundle.entry.push(taskResponse)
    }

    logger.info("Request audit log", {requestBody: requestBody})
    return {
      statusCode: 201,
      body: JSON.stringify(responseBundle)
    }
  } catch (error) {
    logger.error("Error occurred", {error: error})
    const errorResponseBody = {
      resourceType: "OperationOutcome",
      issue: [
        {
          code: "security",
          severity: "fatal",
          details: {
            coding: [
              {
                system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                code: "SERVER_ERROR",
                display: "500: Internal Server Error."
              }
            ]
          },
          diagnostics: "Internal Server Error"
        }
      ]
    }
    return {
      statusCode: 500,
      body: JSON.stringify(errorResponseBody),
      headers: {
        "Content-Type": "application/fhir+json",
        "Cache-Control": "no-cache"
      }
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
