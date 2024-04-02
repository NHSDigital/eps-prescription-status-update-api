import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {handler} from "../src/sandbox"
import {expect, describe, it} from "@jest/globals"
import successData from "../../specification/examples/response-multiple-items.json"

const dummyContext = {}
const mockEvent: Partial<APIGatewayProxyEvent> = {}

describe("Unit test for app handler", () => {
  it("returns a success response", async () => {
    const result: APIGatewayProxyResult = await handler(mockEvent, dummyContext)

    expect(result.statusCode).toEqual(200)
    expect(result.body).toEqual(JSON.stringify(successData))
  })
  it("returns a response with the correct MIME type", async () => {
    const result: APIGatewayProxyResult = await handler(mockEvent, dummyContext)

    expect(result.headers).toEqual({"Content-Type": "application/fhir+json", "Cache-Control": "no-cache"})
  })
})
