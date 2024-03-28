/* eslint-disable @typescript-eslint/no-explicit-any */
import {errorHandler} from "../src/errorHandler"
import middy from "@middy/core"
import {expect, jest} from "@jest/globals"

const mockEvent = {
  foo: "bar"
}

const dummyContext = {
  callbackWaitsForEmptyEventLoop: true,
  functionVersion: "$LATEST",
  functionName: "foo-bar-function",
  memoryLimitInMB: "128",
  logGroupName: "/aws/lambda/foo-bar-function-123456abcdef",
  logStreamName: "2021/03/09/[$LATEST]abcdef123456abcdef123456abcdef123456",
  invokedFunctionArn: "arn:aws:lambda:eu-west-1:123456789012:function:foo-bar-function",
  awsRequestId: "c6af9ac6-7b61-11e6-9a41-93e812345678",
  getRemainingTimeInMillis: () => 1234,
  done: () => console.log("Done!"),
  fail: () => console.log("Failed!"),
  succeed: () => console.log("Succeeded!")
}

test("Middleware logs all error details", async () => {
  type ErrorLogger = (error: any, message: string) => void
  const mockErrorLogger: jest.MockedFunction<ErrorLogger> = jest.fn()
  const mockLogger = {
    error: mockErrorLogger
  }

  const handler = middy(() => {
    throw new Error("error running lambda")
  })

  handler.use(errorHandler({logger: mockLogger}))

  await handler({}, dummyContext)

  expect(mockErrorLogger).toHaveBeenCalledTimes(1)

  const [errorObject, errorMessage] = mockErrorLogger.mock.calls[mockErrorLogger.mock.calls.length - 1]
  expect(errorMessage).toBe("Error: error running lambda")
  expect(errorObject.error.name).toBe("Error")
  expect(errorObject.error.message).toBe("error running lambda")
  expect(errorObject.error.stack).not.toBeNull()
})

test("Middleware returns details as valid fhir from lambda event", async () => {
  const mockLogger = {
    error: jest.fn(() => {})
  }

  const handler = middy(() => {
    throw new Error("error running lambda")
  })

  handler.use(errorHandler({logger: mockLogger}))

  const response = await handler(mockEvent, dummyContext)
  expect(response).toMatchObject({
    schemaVersion: 1,
    isSuccess: false,
    prescriptions: []
  })

})
