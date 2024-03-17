/* eslint-disable @typescript-eslint/no-explicit-any */
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {handler} from "../src/updatePrescriptionStatus"
import {helloworldContext} from "./helloworldContext"
import {mockAPIGatewayProxyEvent} from "./mockAPIGatewayProxyEvent"
import exampleInCollectionLocker from "../../specification/examples/request-in-collection-locker.json"
import exampleMultipleItems from "../../specification/examples/request-multiple-items.json"
import exampleMissingFields from "../../specification/examples/request-missing-fields.json"
import exampleNoItems from "../../specification/examples/request-no-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"

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
  const dummyContext = helloworldContext
  const expectedItem = {
    LineItemID: {"S": "LineItemID"},
    PatientNHSNumber: {"S": "PatientNHSNumber"},
    PharmacyODSCode: {"S": "PharmacyODSCode"},
    PrescriptionID: {"S": "PrescriptionID"},
    RequestID: {"S": "test-request-id"},
    TaskID: {"S": "TaskID"},
    TerminalStatus: {"S": "TerminalStatus"},
    RequestMessage: expect.any(Object)
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("should successfully update a single item into DynamoDB", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID"}}],
              for: {identifier: {value: "PatientNHSNumber"}},
              owner: {identifier: {value: "PharmacyODSCode"}},
              id: "TaskID",
              focus: {identifier: {value: "LineItemID"}},
              status: "TerminalStatus"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, dummyContext)

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining(expectedItem)
        })
      })
    )
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseSingleItem)
  })

  it("should successfully update multiple items into DynamoDB", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID1"}}],
              for: {identifier: {value: "PatientNHSNumber1"}},
              owner: {identifier: {value: "PharmacyODSCode1"}},
              id: "TaskID1",
              focus: {identifier: {value: "LineItemID1"}},
              status: "TerminalStatus1"
            }
          },
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID2"}}],
              for: {identifier: {value: "PatientNHSNumber2"}},
              owner: {identifier: {value: "PharmacyODSCode2"}},
              id: "TaskID2",
              focus: {identifier: {value: "LineItemID2"}},
              status: "TerminalStatus2"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, dummyContext)

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(2)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseMultipleItems)
  })

  it.each([
    {
      example: exampleInCollectionLocker,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for a single item"
    },
    {
      example: exampleMultipleItems,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for multiple items"
    },
    {
      example: exampleNoItems,
      httpResponseCode: 200,
      scenarioDescription: "200 status code if there are no entries to process"
    }
  ])(
    "should return $scenarioDescription",
    async ({example, httpResponseCode}) => {
      const event: APIGatewayProxyEvent = generateMockEvent(example)
      const response: APIGatewayProxyResult = await handler(event, {} as any)

      expect(response.statusCode).toBe(httpResponseCode)
      const responseBody = JSON.parse(response.body!)
      expect(responseBody).toHaveProperty("resourceType", "Bundle")
      expect(responseBody).toHaveProperty("type", "transaction-response")
    })

  it("should return a 400 status code and error message when provided with invalid JSON", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleInCollectionLocker)
    event.headers = {"x-request-id": "test-request-id"}
    event.body = '{ "resourceType": "Bundle",  "type": "transaction", "entry":}'
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
                system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                code: "BAD_REQUEST",
                display: "400: The Server was unable to process the request."
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
                system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                code: "BAD_REQUEST",
                display: "400: Missing required fields: PrescriptionID, PatientNHSNumber"
              }
            ]
          }
        }
      ]
    })
  })

  it("should handle errors with a 500 status code and internal server error message", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID"}}],
              for: {identifier: {value: "PatientNHSNumber"}},
              owner: {identifier: {value: "PharmacyODSCode"}},
              id: "TaskID",
              focus: {identifier: {value: "LineItemID"}},
              status: "TerminalStatus"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const result: APIGatewayProxyResult = await handler(event, {} as any)

    expect(result.statusCode).toEqual(500)
    expect(JSON.parse(result.body)).toEqual({
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
    })
  })

  it("should return 500 status code and internal server error message if an error occurs", async () => {
    const event = {}
    const response: APIGatewayProxyResult = await handler(event, undefined)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({
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
    })
  })
})
