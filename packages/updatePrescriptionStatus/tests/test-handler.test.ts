/* eslint-disable @typescript-eslint/no-explicit-any */
import {handler} from "../src/updatePrescriptionStatus"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {mockClient} from "aws-sdk-client-mock"
import exampleInCollectionLocker from "../../specification/examples/request-in-collection-locker.json"
import exampleMultipleItems from "../../specification/examples/request-multiple-items.json"
import exampleMissingFields from "../../specification/examples/request-missing-fields.json"
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"

mockClient(DynamoDBClient)

const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: JSON.stringify(body),
  headers: {"x-request-id": "test-request-id"},
  multiValueHeaders: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/",
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: "",
  pathParameters: null
})

describe("Unit test for app handler", () => {
  it("should return 201 with response bundle for a single item", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleInCollectionLocker)
    const response: APIGatewayProxyResult = await handler(event, {} as any)

    expect(response.statusCode).toBe(201)
    const responseBody = JSON.parse(response.body!)
    expect(responseBody).toHaveProperty("resourceType", "Bundle")
  })

  it("should return 201 with response bundle for multiple items", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleMultipleItems)
    const response: APIGatewayProxyResult = await handler(event, {} as any)

    expect(response.statusCode).toBe(201)
    const responseBody = JSON.parse(response.body!)
    expect(responseBody).toHaveProperty("resourceType", "Bundle")
  })

  it("should return 400 status code and error message if request body is invalid JSON", async () => {
    const requestBody = "invalid JSON"
    const event: APIGatewayProxyEvent = generateMockEvent(requestBody)
    const response: APIGatewayProxyResult = await handler(event, {} as any)
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
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
    })
  })

  it("should return a 400 status code and error message indicating missing required fields", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleMissingFields)
    const response: APIGatewayProxyResult = await handler(event, {} as any)
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
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
                display: "Missing required fields: PrescriptionID, PatientNHSNumber"
              }
            ]
          }
        }
      ]
    })
  })

  it("should return 500 status code and internal server error message if an error occurs", async () => {
    const event = {
      multiValueHeaders: {},
      httpMethod: "POST",
      isBase64Encoded: false,
      path: "/",
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
      pathParameters: null
    }
    const response: APIGatewayProxyResult = await handler(event, undefined)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body!)).toEqual({
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
    })
  })
})
