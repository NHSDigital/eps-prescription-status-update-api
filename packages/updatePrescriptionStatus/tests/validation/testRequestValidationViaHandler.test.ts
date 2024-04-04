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
  TASK_ID_0,
  TASK_ID_1,
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
    const body: any = {...requestMultipleItems}

    const now = new Date()
    body.entry[0].resource.lastModified = new Date(now.valueOf() + ONE_DAY_IN_MS + 100000).toISOString()

    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = bundleWrap([
      badRequest("Invalid last modified value provided.", TASK_ID_0),
      accepted(TASK_ID_1)
    ])

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(expected)
  })

  it("when multiple items all have validation issues, expect 400 status code and messages indicating validation issues", async () => {
    const body: any = {...requestMultipleItems}

    const now = new Date()
    body.entry[0].resource.lastModified = new Date(now.valueOf() + ONE_DAY_IN_MS + 100000).toISOString()

    delete body.entry[1].resource.basedOn

    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = bundleWrap([
      badRequest("Invalid last modified value provided.", TASK_ID_0),
      badRequest("Missing required field(s) - PrescriptionID.", TASK_ID_1)
    ])

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual(expected)
  })
})
