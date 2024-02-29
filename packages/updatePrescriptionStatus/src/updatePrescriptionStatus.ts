/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDB} from "aws-sdk" // Import DynamoDB from AWS SDK

const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const dynamodb = new DynamoDB() // Initialize DynamoDB client

export const lambdaHandler = async (event: any, context: any) => {
  try {
    // Parse request body
    const requestBody = JSON.parse(event.body)

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
    if (!prescription_id || !patient_nhs_number || !pharmacy_ods_code
        || !line_item_id || !line_item_status || !terminal_status_indicator || !last_updated) {
      return {
        statusCode: 400,
        body: JSON.stringify({error: "Missing required fields"})
      }
    }

    // Update data in DynamoDB
    await dynamodb.putItem({
      TableName: "PrescriptionStatusTable",
      Item: {
        PrescriptionID: {S: prescription_id},
        PatientNHSNumber: {S: patient_nhs_number},
        PharmacyODSCode: {S: pharmacy_ods_code},
        LineItemID: {S: line_item_id},
        LineItemStatus: {S: line_item_status},
        TerminalStatusIndicator: {S: terminal_status_indicator},
        LastUpdated: {S: last_updated},
        Note: {S: note || null} // Ensuring 'null' if note is undefined or null
      }
    }).promise()

    // Return success response
    return {
      statusCode: 201,
      body: JSON.stringify({message: "Prescription status updated successfully"})
    }
  } catch (error) {
    // Log error using powertools logger
    logger.error("Error occurred: ", error as Error) // Cast error to Error type

    // Return error response
    return {
      statusCode: 500,
      body: JSON.stringify({error: "Internal server error"})
    }
  }
}
