/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {handler} from "../../src/updatePrescriptionStatus"
import {DEFAULT_DATE, generateMockEvent} from "../utils/testUtils"
// import {ONE_DAY_IN_MS} from "../../src/validation/content"

import requestSingleItem from "../../../specification/examples/request-dispatched.json"
// import requestMultipleItems from "../../../specification/examples/request-multiple-items.json"
import {bundleWrap, timeoutResponse} from "../../src/utils/responses"

describe("Integration tests for validation via updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  // it("when one validation issue is present in multiple items, expect 400 status code, message indicating validation issues, and message indicating valid item", async () => {
  //   const body: any = deepCopy(requestMultipleItems)
  //   body.entry[0].resource.lastModified = new Date(DEFAULT_DATE.valueOf() + ONE_DAY_IN_MS + 1000).toISOString()

  //   const event: APIGatewayProxyEvent = generateMockEvent(body)

  //   const expected = bundleWrap([badRequest("Invalid last modified value provided.", FULL_URL_0), accepted(FULL_URL_1)])

  //   const response: APIGatewayProxyResult = await handler(event, {})

  //   expect(response.statusCode).toBe(400)
  //   expect(JSON.parse(response.body)).toEqual(expected)
  // })

  // it("when multiple items all have validation issues, expect 400 status code and messages indicating validation issues", async () => {
  //   const body: any = deepCopy(requestMultipleItems)
  //   body.entry[0].resource.lastModified = new Date(DEFAULT_DATE.valueOf() + ONE_DAY_IN_MS + 1000).toISOString()
  //   delete body.entry[1].fullUrl
  //   delete body.entry[1].resource.basedOn

  //   const event: APIGatewayProxyEvent = generateMockEvent(body)

  //   const expected = bundleWrap([
  //     badRequest("Invalid last modified value provided.", FULL_URL_0),
  //     badRequest("Missing required field(s) - FullUrl, PrescriptionID.")
  //   ])

  //   const response: APIGatewayProxyResult = await handler(event, {})

  //   expect(response.statusCode).toBe(400)
  //   expect(JSON.parse(response.body)).toEqual(expected)
  // })

  // it("when id in entry fullUrl doesn't match that in task, expect 400 status code and messages indicating the issue", async () => {
  //   const body: any = deepCopy(requestSingleItem)
  //   body.entry[0].fullUrl = "invalid"

  //   const event: APIGatewayProxyEvent = generateMockEvent(body)

  //   const expected = bundleWrap([badRequest("Invalid entry fullUrl or task id.", "invalid")])

  //   const response: APIGatewayProxyResult = await handler(event, {})

  //   expect(response.statusCode).toBe(400)
  //   expect(JSON.parse(response.body)).toEqual(expected)
  // })

  it("should return 504 status code and timeout error message", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(requestSingleItem)

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual(bundleWrap([timeoutResponse()]))
  })
})
