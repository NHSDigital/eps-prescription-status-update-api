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

const MISSING_FIELDS_RESPONSE: APIGatewayProxyResult = {
  statusCode: 400,
  body: JSON.stringify({error: "Missing required fields"}),
  headers: {
    "Content-Type": "application/fhir+json",
    "Cache-Control": "no-cache"
  }
}

const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Received event:", event)

    // Parse request body
    const requestBody = JSON.parse(event.body || "")
    console.log("Parsed request body:", requestBody)

    // Extract relevant data from request body
    const entries = requestBody.entry
    console.log("Entries:", entries)

    // Validate if the entry array exists and is not empty
    if (!entries || entries.length === 0) {
      console.log("Missing required fields")
      return MISSING_FIELDS_RESPONSE
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

    // Process each entry
    for (const entry of entries) {
      console.log("Processing entry:", entry)
      const entry_resource = entry.resource
      console.log("Entry resource:", entry_resource)

      // Extract data from entry resource
      const task_id = entry_resource.id
      const prescription_id = entry_resource.basedOn[0].identifier.value
      const patient_nhs_number = entry_resource.for.identifier.value
      const pharmacy_ods_code = entry_resource.owner.identifier.value
      const line_item_id = entry_resource.focus.identifier.value
      const terminal_status_indicator = entry_resource.status
      const last_modified = entry_resource.lastModified

      console.log("Extracted data:", {
        task_id,
        prescription_id,
        patient_nhs_number,
        pharmacy_ods_code,
        line_item_id,
        terminal_status_indicator,
        last_modified
      })

      // Validate required fields
      if (
        !prescription_id ||
        !patient_nhs_number ||
        !pharmacy_ods_code ||
        !task_id ||
        !line_item_id ||
        !terminal_status_indicator ||
        !last_modified
      ) {
        console.log("Missing required fields in entry:", entry)
        return MISSING_FIELDS_RESPONSE
      }

      // Marshall the item
      const item = marshall({
        RequestID: uuidv4(),
        PrescriptionID: prescription_id,
        PatientNHSNumber: patient_nhs_number,
        PharmacyODSCode: pharmacy_ods_code,
        TaskID: task_id,
        LineItemID: line_item_id,
        TerminalStatusIndicator: terminal_status_indicator,
        LastModified: last_modified,
        Timestamp: new Date().toISOString(),
        RequestMessage: entry_resource
      })

      console.log("Marshalled item:", item)

      // Put item in DynamoDB table
      const command = new PutItemCommand({
        TableName: tableName,
        Item: item
      })

      console.log("Sending PutItemCommand:", command)
      await client.send(command)

      // Construct the response for each Task resource
      const taskResponse = {
        response: {
          status: "201 Created",
          location: `Task/${task_id}/_history/1`, // Using task_id for location
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

    // Log audit for request
    console.log("Request audit log:", {requestBody})

    // Return success response with the constructed response bundle
    return {
      statusCode: 201,
      body: JSON.stringify(responseBundle)
    }
  } catch (error) {
    // Log error using powertools logger
    console.error("Error occurred:", error)

    // Log audit for request error
    console.error("Request error audit log:", {event})

    // Return error response
    if (error instanceof SyntaxError) {
      return MISSING_FIELDS_RESPONSE
    } else {
      throw error
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
