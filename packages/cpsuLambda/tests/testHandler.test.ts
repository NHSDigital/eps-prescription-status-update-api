import {format_1} from "../src/schema"
import mockContext from "./mockContext"
import format_1_request_json from "./format_1/example_request.json"
import format_1_response_json from "./format_1/example_response.json"
import {HandlerParams, newHandler} from "../src/handler"
import {MIDDLEWARE} from "../src/middleware"
import {Logger} from "@aws-lambda-powertools/logger"
import {jest} from "@jest/globals"
import {Ok} from "pratica"

const {FORMAT_1_PARAMS, format_1_handler} = await import("../src/cpsu")

const format_1_request = () => {
  return JSON.parse(JSON.stringify(format_1_request_json))
}
const format_1_response = () => {
  return JSON.parse(JSON.stringify(format_1_response_json))
}

const dummyContext = mockContext

describe("generic handler", () => {
  test("Headers are appended to logger", async () => {
    const event = {
      headers: {
        "apigw-request-id": "test-apigw-request-id",
        "nhsd-correlation-id": "test-nhsd-correlation-id",
        "nhsd-request-id": "test-nhsd-request-id",
        "x-correlation-id": "test-x-correlation-id"
      }
    }

    const params: HandlerParams<typeof event, undefined> = {
      validator: () => Ok(),
      transformer: (body, logger) => {
        logger.info("test message")
        return Ok()
      }
    }

    const logger = new Logger({serviceName: "testService"})
    const logger_output = jest.spyOn(console, "info")

    const handler = newHandler({
      params: params,
      middleware: [MIDDLEWARE.injectLambdaContext],
      logger: logger
    })

    await handler(event, mockContext)

    const logger_call = JSON.parse(logger_output.mock.calls[0][0])

    expect(logger_call["apigw-request-id"]).toEqual("test-apigw-request-id")
    expect(logger_call["nhsd-correlation-id"]).toEqual("test-nhsd-correlation-id")
    expect(logger_call["nhsd-request-id"]).toEqual("test-nhsd-request-id")
    expect(logger_call["x-correlation-id"]).toEqual("test-x-correlation-id")
  })
})

describe("format_1 handler", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date("2023-09-11T10:11:12Z"))
  })
  test("Happy path", async () => {
    const event = {
      headers: {
        "apigw-request-id": "test-apigw-request-id",
        "nhsd-correlation-id": "test-nhsd-correlation-id",
        "nhsd-request-id": "test-nhsd-request-id",
        "x-correlation-id": "test-x-correlation-id"
      },
      body: format_1_request()
    }

    const expectedResponseBody = format_1_response()

    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    const responseBody = JSON.parse(response.body)

    expect(response.statusCode).toEqual(200)
    responseBody.entry[0].fullUrl = expectedResponseBody.entry[0].fullUrl
    responseBody.entry[0].resource.id = expectedResponseBody.entry[0].resource.id
    responseBody.entry[0].resource.lastModified = expectedResponseBody.entry[0].resource.lastModified

    responseBody.entry[1].fullUrl = expectedResponseBody.entry[1].fullUrl
    responseBody.entry[1].resource.id = expectedResponseBody.entry[1].resource.id
    responseBody.entry[1].resource.lastModified = expectedResponseBody.entry[1].resource.lastModified

    expect(response.headers).toEqual({
      "apigw-request-id": "test-apigw-request-id",
      "nhsd-correlation-id": "test-nhsd-correlation-id",
      "nhsd-request-id": "test-nhsd-request-id",
      "x-correlation-id": "test-x-correlation-id"
    })

    expect(responseBody).toEqual(expectedResponseBody)
  })

  test("Messages that are not of type 'PrescriptionStatusChanged' are ignored", async () => {
    const body = format_1_request()
    body.MessageType = "NOTPrescriptionStatusChanged"

    const event = {
      headers: {},
      body
    }

    const logger = new Logger({serviceName: "testService"})
    const logger_info = jest.spyOn(logger, "info")

    const handler = newHandler({
      params: FORMAT_1_PARAMS,
      middleware: [MIDDLEWARE.validator, MIDDLEWARE.validationErrorHandler],
      logger: logger,
      schema: format_1.eventSchema
    })

    const response = await handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(202)
    expect(JSON.parse(response.body)).toEqual("Message Ignored")
    expect(logger_info).toHaveBeenCalledWith("Message Ignored")
  })

  test("Message missing field receives 400 and appropriate message", async () => {
    const body = format_1_request()
    delete body.oDSCode

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([{error: "must have required property 'oDSCode'", path: "/body"}])
  })

  test("Message missing fields receives 400 and appropriate message", async () => {
    const body = format_1_request()
    delete body.oDSCode
    delete body.items[0].itemID

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([
      {error: "must have required property 'oDSCode'", path: "/body"},
      {error: "must have required property 'itemID'", path: "/body/items/0"}
    ])
  })

  test("Message with incorrect field type receives 400 and appropriate message", async () => {
    const body = format_1_request()
    body.repeatNo = "not a number"

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([{error: "must be number", path: "/body/repeatNo"}])
  })

  test("Requests with no repeatNo are accepted", async () => {
    const body = format_1_request()
    delete body.repeatNo

    const event = {
      headers: {},
      body: body
    }

    const expectedResponse = format_1_response()
    delete expectedResponse.entry[0].resource.input
    delete expectedResponse.entry[1].resource.input

    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(200)
    const responseBody = JSON.parse(response.body)

    responseBody.entry[0].fullUrl = expectedResponse.entry[0].fullUrl
    responseBody.entry[0].resource.id = expectedResponse.entry[0].resource.id
    responseBody.entry[0].resource.lastModified = expectedResponse.entry[0].resource.lastModified

    responseBody.entry[1].fullUrl = expectedResponse.entry[1].fullUrl
    responseBody.entry[1].resource.id = expectedResponse.entry[1].resource.id
    responseBody.entry[1].resource.lastModified = expectedResponse.entry[1].resource.lastModified

    expect(responseBody).toEqual(expectedResponse)
  })

  test("Request with invalid business state returns 400", async () => {
    const body = format_1_request()
    body.items[0].status = "Expired"
    body.deliveryType = "Robot Collection"

    const event = {
      headers: {},
      body: body
    }

    const logger = new Logger({serviceName: "testService"})
    const logger_info = jest.spyOn(logger, "info")

    const handler = newHandler({
      params: FORMAT_1_PARAMS,
      middleware: [MIDDLEWARE.validator, MIDDLEWARE.validationErrorHandler],
      logger: logger,
      schema: format_1.eventSchema
    })

    const response = await handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([`Invalid business status on item ${body.items[0].itemID}`])
    expect(logger_info).toHaveBeenCalledWith(
      `Invalid business status on item ${body.items[0].itemID}.` +
        `Unable to map delivery type ${body.deliveryType} and item status ${body.items[0].status}`
    )
  })

  test("Repeat messages are translated with matching UUIDs", async () => {
    const event = {
      headers: {},
      body: format_1_request()
    }

    const response_1 = await format_1_handler(event as format_1.eventType, dummyContext)
    const response_2 = await format_1_handler(event as format_1.eventType, dummyContext)

    const response_1_body = JSON.parse(response_1.body)
    const response_2_body = JSON.parse(response_2.body)

    expect(response_1_body.entry[0].fullUrl).toEqual(response_2_body.entry[0].fullUrl)
    expect(response_1_body.entry[0].resource.id).toEqual(response_2_body.entry[0].resource.id)
    expect(response_1_body.entry[1].fullUrl).toEqual(response_2_body.entry[1].fullUrl)
    expect(response_1_body.entry[1].resource.id).toEqual(response_2_body.entry[1].resource.id)
  })

  test("UUIDs are unique if item or prescription details are different", async () => {
    const event_1 = {
      headers: {},
      body: format_1_request()
    }

    const event_2 = {
      headers: {},
      body: format_1_request()
    }
    event_2.body.items[0].itemID = "different item ID"

    const response_1 = await format_1_handler(event_1 as format_1.eventType, dummyContext)
    const response_2 = await format_1_handler(event_2 as format_1.eventType, dummyContext)

    const response_1_body = JSON.parse(response_1.body)
    const response_2_body = JSON.parse(response_2.body)

    // Different uuid since item ID is different
    expect(response_1_body.entry[0].fullUrl).not.toBe(response_2_body.entry[0].fullUrl)
    expect(response_1_body.entry[0].resource.id).not.toBe(response_2_body.entry[0].resource.id)

    // Same uuid since item ID is not different
    expect(response_1_body.entry[1].fullUrl).toBe(response_2_body.entry[1].fullUrl)
    expect(response_1_body.entry[1].resource.id).toBe(response_2_body.entry[1].resource.id)
  })
})
