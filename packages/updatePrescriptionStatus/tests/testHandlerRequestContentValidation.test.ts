/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {handler} from "../src/updatePrescriptionStatus"
import {DEFAULT_DATE, TASK_ID_0, generateMockEvent} from "./utils/testUtils"
import {ONE_DAY_IN_MS} from "../src/requestContentValidation"

import exampleDispatched from "../../specification/examples/request-dispatched.json"
import {badRequest, bundleWrap} from "../src/utils/responses"

describe("Unit test for validation via updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when content validation issues are present, expect a 400 status code and 400 response code(s)", async () => {
    const body: any = {...exampleDispatched}

    const now = new Date()
    body.entry[0].resource.lastModified = new Date(now.valueOf() + ONE_DAY_IN_MS + 100000).toISOString()
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = bundleWrap([badRequest("Invalid last modified value provided.", TASK_ID_0)])

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual(expected)
  })
})
