/* eslint-disable @typescript-eslint/no-explicit-any */
import {handler} from "../src/updatePrescriptionStatus"
import {mockClient} from "aws-sdk-client-mock"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {APIGatewayProxyEvent} from "aws-lambda"

describe("Unit test for app handler", () => {
  beforeEach(() => {
    mockClient(DynamoDBClient)
  })

  afterEach(() => {
    mockClient(DynamoDBClient).restore()
  })

  it("should update data in DynamoDB and return success response", async () => {
    // Test case implementation
    const event: APIGatewayProxyEvent = {
      body: JSON.stringify({
        prescription_id: "prescription_id_value",
        patient_nhs_number: "patient_nhs_number_value",
        pharmacy_ods_code: "pharmacy_ods_code_value",
        line_item_id: "line_item_id_value",
        line_item_status: "line_item_status_value",
        terminal_status_indicator: "terminal_status_indicator_value",
        last_updated: "last_updated_value",
        note: "note_value"
      }),
      headers: {}, // Add empty headers
      multiValueHeaders: {}, // Add empty multiValueHeaders
      httpMethod: "POST", // Add httpMethod
      isBase64Encoded: false, // Add isBase64Encoded
      path: "/", // Add path
      pathParameters: null, // Add pathParameters
      queryStringParameters: null, // Add queryStringParameters
      multiValueQueryStringParameters: null, // Add multiValueQueryStringParameters
      stageVariables: null, // Add stageVariables
      requestContext: {} as any, // Mock requestContext object
      resource: "" // Add resource
    }

    const response = await handler(event, {} as any) // Add an empty object as the second argument
    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body!)).toEqual({
      message: "Prescription status updated successfully"
    })
  })

  it("should return 400 status code and error message if required fields are missing", async () => {
    // Test case implementation
    const event: APIGatewayProxyEvent = {
      body: JSON.stringify({}),
      headers: {}, // Add empty headers
      multiValueHeaders: {}, // Add empty multiValueHeaders
      httpMethod: "POST", // Add httpMethod
      isBase64Encoded: false, // Add isBase64Encoded
      path: "/", // Add path
      pathParameters: null, // Add pathParameters
      queryStringParameters: null, // Add queryStringParameters
      multiValueQueryStringParameters: null, // Add multiValueQueryStringParameters
      stageVariables: null, // Add stageVariables
      requestContext: {} as any, // Mock requestContext object
      resource: "" // Add resource
    }

    const response = await handler(event, {} as any) // Add an empty object as the second argument
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Missing required fields"
    })
  })

  it("should return 500 status code and error message if an error occurs", async () => {
    // Test case implementation
    mockClient(DynamoDBClient).rejects(new Error("Internal server error"))
    const event: APIGatewayProxyEvent = {
      body: JSON.stringify({
        prescription_id: "prescription_id_value",
        patient_nhs_number: "patient_nhs_number_value",
        pharmacy_ods_code: "pharmacy_ods_code_value",
        line_item_id: "line_item_id_value",
        line_item_status: "line_item_status_value",
        terminal_status_indicator: "terminal_status_indicator_value",
        last_updated: "last_updated_value",
        note: "note_value"
      }),
      headers: {}, // Add empty headers
      multiValueHeaders: {}, // Add empty multiValueHeaders
      httpMethod: "POST", // Add httpMethod
      isBase64Encoded: false, // Add isBase64Encoded
      path: "/", // Add path
      pathParameters: null, // Add pathParameters
      queryStringParameters: null, // Add queryStringParameters
      multiValueQueryStringParameters: null, // Add multiValueQueryStringParameters
      stageVariables: null, // Add stageVariables
      requestContext: {} as any, // Mock requestContext object
      resource: "" // Add resource
    }

    const response = await handler(event, {} as any) // Add an empty object as the second argument
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Internal server error"
    })
  })
})
