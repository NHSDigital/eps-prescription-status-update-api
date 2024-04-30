import {APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import axios from "axios"
import MockAdapter from "axios-mock-adapter"
import {
  jest,
  expect,
  describe,
  it
} from "@jest/globals"
import {handler} from "../src/statusLambda"
import mockContext from "./mockContext"
import mockAPIGatewayProxyEvent from "./mockAPIGatewayProxyEvent"

const mock = new MockAdapter(axios)

const dummyContext = mockContext

describe("Unit test for status check", function () {
  let originalEnv: {[key: string]: string | undefined}
  afterEach(() => {
    process.env = {...originalEnv}
    mock.reset()
  })

  it("returns commit id from environment", async () => {
    process.env.COMMIT_ID = "test_commit_id"
    process.env.TargetSpineServer = "sandbox"

    const result: APIGatewayProxyResult = (await handler(
      mockAPIGatewayProxyEvent,
      dummyContext
    )) as APIGatewayProxyResult

    expect(result.statusCode).toEqual(200)
    expect(JSON.parse(result.body)).toMatchObject({
      commitId: "test_commit_id"
    })
  })

  it("returns version number from environment", async () => {
    process.env.VERSION_NUMBER = "test_version_number"
    process.env.TargetSpineServer = "sandbox"

    const result: APIGatewayProxyResult = (await handler(
      mockAPIGatewayProxyEvent,
      dummyContext
    )) as APIGatewayProxyResult

    expect(result.statusCode).toEqual(200)
    expect(JSON.parse(result.body)).toMatchObject({
      versionNumber: "test_version_number"
    })
  })

  it("appends trace id's to the logger", async () => {
    const mockAppendKeys = jest.spyOn(Logger.prototype, "appendKeys")

    await handler(mockAPIGatewayProxyEvent, dummyContext)

    expect(mockAppendKeys).toHaveBeenCalledWith({
      "x-request-id": "test-request-id",
      "x-correlation-id": "test-correlation-id",
      "apigw-request-id": "c6af9ac6-7b61-11e6-9a41-93e8deadbeef"
    })
  })

  it("returns no-cache Cache-Control header", async () => {
    process.env.COMMIT_ID = "test_commit_id"
    process.env.TargetSpineServer = "sandbox"

    const result: APIGatewayProxyResult = (await handler(
      mockAPIGatewayProxyEvent,
      dummyContext
    )) as APIGatewayProxyResult

    const headers = result.headers

    expect(headers).toMatchObject({
      "Cache-Control": "no-cache"
    })
  })
})
