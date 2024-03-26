/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {handler} from "../src/updatePrescriptionStatus"
import {
  DEFAULT_DATE,
  generateBody,
  generateExpectedItems,
  generateMockEvent,
  TASK_ID_1
} from "./utils/testUtils"

import requestDispatched from "../../specification/examples/request-dispatched.json"
import requestMultipleItems from "../../specification/examples/request-multiple-items.json"
import requestMissingFields from "../../specification/examples/request-missing-fields.json"
import requestMultipleMissingFields from "../../specification/examples/request-multiple-missing-fields.json"
import requestNoItems from "../../specification/examples/request-no-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"
import responseBadRequest from "../../specification/examples/response-bad-request.json"
import {badRequest, serverError} from "../src/utils/responses"

describe("Unit test for updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when single item in request, expect a single item sent to DynamoDB", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          RequestItems: expect.objectContaining(
            generateExpectedItems()
          )
        })
      })
    )
  })

  it("when multiple items in request, expect multiple items sent to DynamoDB in a single call", async () => {
    const body = generateBody(2)
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(JSON.parse(response.body)).toEqual(responseMultipleItems)

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          RequestItems: expect.objectContaining(
            generateExpectedItems(2)
          )
        })
      })
    )
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
  ])(
    "should return $scenarioDescription",
    async ({example, httpResponseCode}) => {
      const event: APIGatewayProxyEvent = generateMockEvent(example)

      jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

      const response: APIGatewayProxyResult = await handler(event, {})

      const responseBody = JSON.parse(response.body)
      expect(response.statusCode).toBe(httpResponseCode)
      expect(responseBody).toHaveProperty("resourceType", "Bundle")
      expect(responseBody).toHaveProperty("type", "transaction-response")
    })

  it("when invalid json, expect 400 status code and error message", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(requestDispatched)
    const invalidJson = '{ "resourceType": "Bundle",  "type": "transaction", "entry":}'
    event.body = invalidJson

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(responseBadRequest)
  })

  it("when missing fields, expect 400 status code and message indicating missing fields", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(requestMissingFields)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      meta: {
        lastUpdated: DEFAULT_DATE.toISOString()
      },
      entry: [
        {
          response: {
            status: "400 Bad Request",
            outcome: badRequest("Missing required fields - PharmacyODSCode, TaskID")
          }
        }
      ]
    })
  })

  it("when dynamo call fails, expect 500 status code and internal server error message", async () => {
    const event = generateMockEvent(requestDispatched)

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(JSON.parse(response.body)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      meta: {
        lastUpdated: DEFAULT_DATE.toISOString()
      },
      entry: [
        {
          response: {
            status: "500 Internal Server Error",
            outcome: serverError()
          }
        }
      ]
    })
  })

  it("when multiple tasks have missing fields, expect 400 status code and messages indicating missing fields", async () => {
    const body: any = {...requestMultipleMissingFields}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      meta: {
        lastUpdated: DEFAULT_DATE.toISOString()
      },
      entry: [
        {
          response: {
            status: "400 Bad Request",
            outcome: badRequest("Missing required fields - PharmacyODSCode, TaskID")
          }
        },
        {
          fullUrl: TASK_ID_1,
          response: {
            status: "400 Bad Request",
            outcome: badRequest("Missing required fields - PharmacyODSCode")
          }
        }
      ]
    })
  })

  it("when general error occurs, expect 500 status code and internal server error message", async () => {
    const response: APIGatewayProxyResult = await handler({}, undefined)

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
