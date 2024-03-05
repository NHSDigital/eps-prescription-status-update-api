import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger, injectLambdaContext} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})
const tableName = process.env.TABLE_NAME

const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse request body
    const requestBody = JSON.parse(event.body || "")

    // Extract relevant data from request body
    const entries = requestBody.entry

    // Validate if the entry array exists and is not empty
    if (!entries || entries.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({error: "Missing required fields"})
      }
    }

    // Process each entry
    for (const entry of entries) {
      const request_entry = entry.resource

      const prescription_id = request_entry.basedOn[0].identifier.value
      const patient_nhs_number = request_entry.for.identifier.value
      const pharmacy_ods_code = request_entry.owner.identifier.value
      const line_item_id = request_entry.focus.identifier.value
      const line_item_status = request_entry.businessStatus.coding[0].code
      const terminal_status_indicator = request_entry.status
      const last_modified = request_entry.lastModified
      const note = request_entry.note[0].text

      // Validate required fields
      if (
        !prescription_id ||
        !patient_nhs_number ||
        !pharmacy_ods_code ||
        !line_item_id ||
        !line_item_status ||
        !terminal_status_indicator ||
        !last_modified
      ) {
        return {
          statusCode: 400,
          body: JSON.stringify({requestBody, error: "Missing required fields"})
        }
      }

      // Marshall the item
      const item = marshall({
        PrescriptionID: prescription_id,
        PatientNHSNumber: patient_nhs_number,
        PharmacyODSCode: pharmacy_ods_code,
        LineItemID: line_item_id,
        LineItemStatus: line_item_status,
        TerminalStatusIndicator: terminal_status_indicator,
        LastModified: last_modified,
        Note: note || null // Ensuring 'null' if note is undefined or null
      })

      // Put item in DynamoDB table
      const command = new PutItemCommand({
        TableName: tableName,
        Item: item
      })

      await client.send(command)
    }

    // Log audit for request
    logger.info("updatePrescriptionStatus request", {requestBody})

    // Return success response
    return {
      statusCode: 201,
      body: JSON.stringify({message: "Prescription status updated successfully"})
    }
  } catch (error) {
    // Log error using powertools logger
    logger.error("Error occurred: ", error as Error) // Cast error to Error type

    // Log audit for request error
    logger.error("updatePrescriptionStatus request error", {event})

    // Return error response
    if (error instanceof SyntaxError) {
      const errorResponseBody = {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: "2024-01-30T12:01:24Z"
        },
        issue: [
          {
            severity: "error",
            code: "processing",
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/Spine-ErrorOrWarningCode",
                  code: "INVALID_VALUE",
                  display: "Invalid value"
                }
              ]
            },
            diagnostics: "Invalid prescription ID"
          }
        ]
      }

      // Return 400 Bad Request if the request body is not valid JSON
      return {
        statusCode: 400,
        body: JSON.stringify(errorResponseBody),
        headers: {
          "Content-Type": "application/fhir+json",
          "Cache-Control": "no-cache"
        }
      }
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
