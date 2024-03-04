import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger, injectLambdaContext} from "@aws-lambda-powertools/logger"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {PutItemCommand} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import errorHandler from "@nhs/fhir-middy-error-handler"

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})

const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse request body
    let requestBody
    if (typeof event.body === "string") {
      requestBody = JSON.parse(event.body)
    } else {
      throw new Error("Invalid request body")
    }

    // Extract relevant data from request body
    const {
      prescription_id,
      patient_nhs_number,
      pharmacy_ods_code,
      line_item_id,
      line_item_status,
      terminal_status_indicator,
      last_updated,
      note
    } = requestBody

    // Validate required fields
    if (
      !prescription_id ||
      !patient_nhs_number ||
      !pharmacy_ods_code ||
      !line_item_id ||
      !line_item_status ||
      !terminal_status_indicator ||
      !last_updated
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({error: "Missing required fields"})
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
      LastUpdated: last_updated,
      Note: note || null // Ensuring 'null' if note is undefined or null
    })

    // Put item in DynamoDB table
    const command = new PutItemCommand({
      TableName: "PrescriptionStatusTable",
      Item: item
    })

    await client.send(command)

    // Return success response
    return {
      statusCode: 201,
      body: JSON.stringify({message: "Prescription status updated successfully"})
    }
  } catch (error) {
    // Log error using powertools logger
    logger.error("Error occurred: ", error as Error) // Cast error to Error type

    // Return error response
    if (error instanceof SyntaxError) {
      // Return 400 Bad Request if the request body is not valid JSON
      return {
        statusCode: 400,
        body: JSON.stringify({error: "Invalid request body"})
      }
    } else {
      // Log other unexpected errors
      logger.error("Unexpected error occurred: ", error as Error)

      // Return 500 Internal Server Error for other errors
      return {
        statusCode: 500,
        body: JSON.stringify({error: "Internal server error"})
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
