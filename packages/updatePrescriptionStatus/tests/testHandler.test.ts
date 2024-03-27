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
  TASK_ID_1,
  generateBody,
  generateExpectedItems,
  generateMockEvent
} from "./utils/testUtils"

import requestDispatched from "../../specification/examples/request-dispatched.json"
import requestMultipleItems from "../../specification/examples/request-multiple-items.json"
import requestMissingFields from "../../specification/examples/request-missing-fields.json"
import requestMultipleMissingFields from "../../specification/examples/request-multiple-missing-fields.json"
import requestNoItems from "../../specification/examples/request-no-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"
import responseBadRequest from "../../specification/examples/response-bad-request.json"
import {badRequest, bundleWrap, serverError} from "../src/utils/responses"

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
    expect(JSON.parse(response.body)).toEqual(bundleWrap(
      [badRequest("Missing required fields - PharmacyODSCode, TaskID.")]
    ))
  })

  it("when dynamo call fails, expect 500 status code and internal server error message", async () => {
    const event = generateMockEvent(requestDispatched)

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([serverError()]))
  })

  it("when multiple tasks have missing fields, expect 400 status code and messages indicating missing fields", async () => {
    const body: any = {...requestMultipleMissingFields}
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([
      badRequest("Missing required fields - PharmacyODSCode, TaskID."),
      badRequest("Missing required fields - PharmacyODSCode.", TASK_ID_1)
    ]))
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
})
