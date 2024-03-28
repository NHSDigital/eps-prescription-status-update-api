import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {handler} from "../src/getStatusUpdates"
import {runDynamoDBQueries} from "../src/dynamoDBclient.ts"
import {DynamoDBResult} from "../src/schema/result"

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

function mockRunDynamoDBQueries(): Array<Promise<Array<DynamoDBResult>>> {
  const emptyResult: Array<DynamoDBResult> = [{
    prescriptionID: undefined,
    itemId: undefined,
    latestStatus: undefined,
    isTerminalState: undefined,
    lastUpdateDateTime: undefined
  }]
  const emptyPromise: Promise<Array<DynamoDBResult>> = Promise.resolve(emptyResult)
  const emptyFinal: Array<Promise<Array<DynamoDBResult>>> = [emptyPromise, emptyPromise]
  return emptyFinal
}

describe("test handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.mock("../src/dynamoDBclient.ts", () => ({
      runDynamoDBQueries: jest.fn().mockImplementation(mockRunDynamoDBQueries),
    }))
  })

  it("respond with error when schema version is 2", async () => {
    const response = await handler({schemaVersion: 2}, dummyContext)
    expect(response).toMatchObject({
      schemaVersion: 1,
      isSuccess: false,
      prescriptions: []
    })
  })

  it("respond with success when everything is correct", async () => {
    const response = await handler(
      {
        "schemaVersion": 1,
        "prescriptions": []
      }, dummyContext)
    expect(response).toMatchObject({
      schemaVersion: 1,
      isSuccess: true,
      prescriptions: []
    })
  })
})
