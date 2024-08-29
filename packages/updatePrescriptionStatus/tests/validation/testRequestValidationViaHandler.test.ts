/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {handler} from "../../src/updatePrescriptionStatus"
import {
  DEFAULT_DATE,
  FULL_URL_0,
  FULL_URL_1,
  deepCopy,
  generateMockEvent
} from "../utils/testUtils"
import {ONE_DAY_IN_MS} from "../../src/validation/content"

import requestMultipleItems from "../../../specification/examples/request-multiple-items.json"
import {accepted, badRequest, bundleWrap} from "../../src/utils/responses"

describe("Integration tests for validation via updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when one validation issue is present in multiple items, expect 400 status code, message indicating validation issues, and message indicating valid item", async () => {
    const body: any = deepCopy(requestMultipleItems)
    body.entry[0].resource.lastModified = new Date(DEFAULT_DATE.valueOf() + ONE_DAY_IN_MS + 1000).toISOString()

    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = bundleWrap([badRequest(["Last modified value was more than one day in the future."], FULL_URL_0), accepted(FULL_URL_1)])

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(expected)
  })

  it("when multiple items all have validation issues, expect 400 status code and messages indicating validation issues", async () => {
    const body: any = deepCopy(requestMultipleItems)
    body.entry[0].resource.for.identifier.value = "invalidNhsNumber"
    body.entry[1].resource.lastModified = new Date(DEFAULT_DATE.valueOf() + ONE_DAY_IN_MS + 1000).toISOString()

    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = bundleWrap([
      badRequest(["NHS number is invalid.", "NHS number is not in a known, valid range."], FULL_URL_0),
      badRequest(["Last modified value was more than one day in the future."], FULL_URL_1)
    ])

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(expected)
  })
})
