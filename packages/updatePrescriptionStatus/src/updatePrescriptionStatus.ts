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
  RequestID: string;
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
    console.log("Received event:", event)
    const requestBody = JSON.parse(event.body || "")
    console.log("Parsed request body:", requestBody)

    const entries = requestBody.entry
    console.log("Entries:", entries)

    if (!entries || entries.length === 0) {
      console.log("Missing required fields")
      return {
        statusCode: 400,
        body: JSON.stringify({error: "Missing required fields"}),
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
      console.log("Processing entry:", entry)
      const entry_resource = entry.resource
      console.log("Entry resource:", entry_resource)

      const dynamoDBItem: DynamoDBItem = {
        RequestID: "",
        PrescriptionID: "",
        PatientNHSNumber: "",
        PharmacyODSCode: "",
        TaskID: "",
        LineItemID: "",
        TerminalStatusIndicator: "",
        LastModified: "",
        Timestamp: "",
        RequestMessage: {}
      }

      dynamoDBItem.RequestID = uuidv4()
      dynamoDBItem.PrescriptionID =
        entry_resource.basedOn?.[0]?.identifier?.value
      dynamoDBItem.PatientNHSNumber = entry_resource.for?.identifier?.value
      dynamoDBItem.PharmacyODSCode = entry_resource.owner?.identifier?.value
      dynamoDBItem.TaskID = entry_resource.id
      dynamoDBItem.LineItemID = entry_resource.focus?.identifier?.value
      dynamoDBItem.TerminalStatusIndicator = entry_resource.status
      dynamoDBItem.LastModified = entry_resource.lastModified
      dynamoDBItem.Timestamp = new Date().toISOString()
      dynamoDBItem.RequestMessage = entry_resource

      const invalidFields = []
      for (const field in dynamoDBItem) {
        if (!dynamoDBItem[field as keyof DynamoDBItem]) {
          invalidFields.push(field)
        }
      }

      if (invalidFields.length > 0) {
        const errorMessage = `Missing required fields: ${invalidFields.join(
          ", "
        )}`
        console.log(errorMessage)
        return {
          statusCode: 400,
          body: JSON.stringify({error: errorMessage}),
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache"
          }
        }
      }

      const item = marshall(dynamoDBItem)
      console.log("Marshalled item:", item)

      const command = new PutItemCommand({
        TableName: tableName,
        Item: item
      })
      console.log("Sending PutItemCommand:", command)
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

      console.log("Task response:", taskResponse)
      responseBundle.entry.push(taskResponse)
    }

    console.log("Request audit log:", {requestBody})
    return {
      statusCode: 201,
      body: JSON.stringify(responseBundle)
    }
  } catch (error) {
    console.error("Error occurred:", error)
    console.error("Request error audit log:", {event})
    return {
      statusCode: 500,
      body: JSON.stringify({error: "Internal Server Error"}),
      headers: {
        "Content-Type": "application/json",
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
