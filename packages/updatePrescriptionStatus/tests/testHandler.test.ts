/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {
  DEFAULT_DATE,
  FULL_URL_0,
  FULL_URL_1,
  generateBody,
  generateExpectedItems,
  generateMockEvent,
  mockDynamoDBClient
} from "./utils/testUtils"

import requestDispatched from "../../specification/examples/request-dispatched.json"
import requestMultipleItems from "../../specification/examples/request-multiple-items.json"
import requestMissingFields from "../../specification/examples/request-missing-fields.json"
import requestMultipleMissingFields from "../../specification/examples/request-multiple-missing-fields.json"
import requestNoItems from "../../specification/examples/request-no-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"
import {
  badRequest,
  bundleWrap,
  serverError,
  timeoutResponse
} from "../src/utils/responses"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
import {persistDataItems} from "../src/utils/databaseClient"

const {mockSend, mockTransact} = mockDynamoDBClient()
const {handler} = await import("../src/updatePrescriptionStatus")
const LAMBDA_TIMEOUT_MS = 9500 // 9.5 sec

describe("Integration tests for updatePrescriptionStatus handler", () => {
  beforeAll(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
    jest.clearAllTimers()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when request doesn't have correct resourceType and type, expect 400 status code and appropriate message", async () => {
    const body = {resourceType: "NotBundle", type: "not_transaction"}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([badRequest("Request body does not have resourceType of 'Bundle' and type of 'transaction'.")])
    )
  })

  it("when single item in request, expect a single item sent to DynamoDB", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))
  })

  it("when multiple items in request, expect multiple items sent to DynamoDB in a single call", async () => {
    const body = generateBody(2)
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems(2)
    mockTransact.mockReturnValue(expectedItems)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseMultipleItems)

    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))
  })

  it.each([
    {
      example: requestDispatched,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for a single item"
    },
    {
      example: requestMultipleItems,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for multiple items"
    },
    {
      example: requestNoItems,
      httpResponseCode: 200,
      scenarioDescription: "200 status code if there are no entries to process"
    }
  ])("should return $scenarioDescription", async ({example, httpResponseCode}) => {
    const event: APIGatewayProxyEvent = generateMockEvent(example)

    const response: APIGatewayProxyResult = await handler(event, {})

    const responseBody = JSON.parse(response.body)
    expect(response.statusCode).toBe(httpResponseCode)
    expect(responseBody).toHaveProperty("resourceType", "Bundle")
    expect(responseBody).toHaveProperty("type", "transaction-response")
  })

  it("when missing fields, expect 400 status code and message indicating missing fields", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(requestMissingFields)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([badRequest("Missing required field(s) - PharmacyODSCode, TaskID.", FULL_URL_0)])
    )
  })

  it("when dynamo call fails, expect 500 status code and internal server error message", async () => {
    const event = generateMockEvent(requestDispatched)
    mockSend.mockRejectedValue(new Error() as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([serverError()]))
  })

  it("when data store update times out, expect 504 status code and relevant error message", async () => {
    mockSend.mockImplementation(() => new Promise(() => {}))

    const event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const eventHandler: Promise<APIGatewayProxyResult> = handler(event, {})

    await jest.advanceTimersByTimeAsync(LAMBDA_TIMEOUT_MS)

    const response = await eventHandler
    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([timeoutResponse()]))
  })

  it("when multiple tasks have missing fields, expect 400 status code and messages indicating missing fields", async () => {
    const body: any = {...requestMultipleMissingFields}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(
      bundleWrap([
        badRequest("Missing required field(s) - PharmacyODSCode, TaskID.", FULL_URL_0),
        badRequest("Missing required field(s) - PharmacyODSCode.", FULL_URL_1)
      ])
    )
  })

  it("when x-request-id header is present but empty, expect 400 status code and relevant error message", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    event.headers["x-request-id"] = undefined

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([badRequest("Missing or empty x-request-id header.")]))
  })

  it("when x-request-id header is missing, expect 400 status code and relevant error message", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    delete event.headers["x-request-id"]

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([badRequest("Missing or empty x-request-id header.")]))
  })

  it("when x-request-id header is mixed case, expect it to work", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    delete event.headers["x-request-id"]
    event.headers["X-Request-id"] = "43313002-debb-49e3-85fa-34812c150242"

    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
  })

  it("when the conditional check fails, an error is thrown", async () => {
    const dataItems = [
      {
        LastModified: "2023-01-01T00:00:00Z",
        LineItemID: "LineItemID_1",
        PatientNHSNumber: "PatientNHSNumber_1",
        PharmacyODSCode: "PharmacyODSCode_1",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_1",
        Status: "Status_1",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_1"
      },
      {
        LastModified: "2023-01-02T00:00:00Z",
        LineItemID: "LineItemID_2",
        PatientNHSNumber: "PatientNHSNumber_2",
        PharmacyODSCode: "PharmacyODSCode_2",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_2",
        Status: "Status_2",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_2"
      }
    ]

    mockSend.mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        message: "transaction cancelled."
      }) as never
    )

    try {
      await persistDataItems(dataItems)
    } catch (e) {
      expect(e).toBeInstanceOf(TransactionCanceledException)
    }
  })
})

// describe("Unit test persistDataItems", () => {
//   beforeEach(() => {
//     jest.resetModules()
//     jest.clearAllMocks()
//   })
//   it("when the conditional check fails, an error is thrown", async () => {
//     const dataItems = [
//       {
//         LastModified: "2023-01-01T00:00:00Z",
//         LineItemID: "LineItemID_1",
//         PatientNHSNumber: "PatientNHSNumber_1",
//         PharmacyODSCode: "PharmacyODSCode_1",
//         PrescriptionID: "PrescriptionID_1",
//         RequestID: "RequestID_1",
//         Status: "Status_1",
//         TaskID: "TaskID_1",
//         TerminalStatus: "TerminalStatus_1"
//       },
//       {
//         LastModified: "2023-01-02T00:00:00Z",
//         LineItemID: "LineItemID_2",
//         PatientNHSNumber: "PatientNHSNumber_2",
//         PharmacyODSCode: "PharmacyODSCode_2",
//         PrescriptionID: "PrescriptionID_1",
//         RequestID: "RequestID_2",
//         Status: "Status_2",
//         TaskID: "TaskID_1",
//         TerminalStatus: "TerminalStatus_2"
//       }
//     ]

//     mockSend.mockRejectedValue(
//       new TransactionCanceledException({
//         $metadata: {},
//         message: "transaction cancelled."
//       }) as never
//     )

//     try {
//       await persistDataItems(dataItems)
//     } catch (e) {
//       expect(e).toBeInstanceOf(TransactionCanceledException)
//     }
//   }, 12000)
// })
