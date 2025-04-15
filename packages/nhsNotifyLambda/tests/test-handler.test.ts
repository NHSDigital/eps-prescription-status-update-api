import {expect, describe, it} from "@jest/globals"

import {APIGatewayProxyResult} from "aws-lambda"

import axios from "axios"
import MockAdapter from "axios-mock-adapter"

import {handler} from "../src/nhsNotifyLambda"
import {mockAPIGatewayProxyEvent, mockContext} from "@PrescriptionStatusUpdate_common/testing"

const mock = new MockAdapter(axios)

describe("Unit test for NHS Notify lambda handler", function () {
  let originalEnv: {[key: string]: string | undefined} = process.env
  afterEach(() => {
    process.env = {...originalEnv}
    mock.reset()
  })

  it("Dummy test", async () => {
    console.error("DUMMY TEST - PASSING ANYWAY")

    const result: APIGatewayProxyResult = (await handler(
      mockAPIGatewayProxyEvent,
      mockContext
    )) as APIGatewayProxyResult

    expect(result.statusCode).toEqual(200)
  })
})
