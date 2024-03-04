/* eslint-disable @typescript-eslint/no-explicit-any */
import {handler} from "../src/updatePrescriptionStatus"
import {mockClient} from "aws-sdk-client-mock"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {APIGatewayProxyEvent} from "aws-lambda"

// Function to generate mock event object
const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: JSON.stringify(body),
  headers: {},
  multiValueHeaders: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/",
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: "",
  pathParameters: null // Add pathParameters property
})

describe("Unit test for app handler", () => {
  beforeEach(() => {
    mockClient(DynamoDBClient)
  })

  afterEach(() => {
    mockClient(DynamoDBClient).restore()
  })

  it("should update data in DynamoDB and return success response", async () => {
    const requestBody = {
      prescription_id: "prescription_id_value",
      patient_nhs_number: "patient_nhs_number_value",
      pharmacy_ods_code: "pharmacy_ods_code_value",
      line_item_id: "line_item_id_value",
      line_item_status: "line_item_status_value",
      terminal_status_indicator: "terminal_status_indicator_value",
      last_updated: "last_updated_value",
      note: "note_value"
    }

    const response = await handler(
      generateMockEvent(requestBody),
      {} as any
    )
    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body!)).toEqual({
      message: "Prescription status updated successfully"
    })
  })

  it("should return 400 status code and error message if required fields are missing", async () => {
    const requestBody = {}

    const response = await handler(
      generateMockEvent(requestBody),
      {} as any
    )
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Missing required fields"
    })
  })

  it("should return 400 status code and error message if request body is invalid JSON", async () => {
    const requestBody = "invalid JSON"

    const response = await handler(
      generateMockEvent(requestBody),
      {} as any
    )
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Missing required fields"
    })
  })

  it("should return 500 status code and error message if an unexpected error occurs", async () => {
    mockClient(DynamoDBClient).rejects(new Error("Internal server error"))

    const requestBody = {
      prescription_id: "prescription_id_value",
      patient_nhs_number: "patient_nhs_number_value",
      pharmacy_ods_code: "pharmacy_ods_code_value",
      line_item_id: "line_item_id_value",
      line_item_status: "line_item_status_value",
      terminal_status_indicator: "terminal_status_indicator_value",
      last_updated: "last_updated_value",
      note: "note_value"
    }

    const response = await handler(
      generateMockEvent(requestBody),
      {} as any
    )
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Internal server error"
    })
  })
})
