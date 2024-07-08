import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {handler} from "../src/getStatusUpdates"

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

describe("test handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  const testCases = [
    {
      description: "responds with error when schema version is 2",
      event: {
        schemaVersion: 2,
        prescriptions: [
          {
            prescriptionID: "abc",
            odsCode: "123"
          }
        ]
      },
      mockReply: null,
      expectedResponse: {
        schemaVersion: 1,
        isSuccess: false,
        prescriptions: []
      }
    },
    {
      description: "responds with success for empty request",
      event: {
        schemaVersion: 1,
        prescriptions: []
      },
      mockReply: {
        Count: 0,
        Items: []
      },
      expectedResponse: {
        schemaVersion: 1,
        isSuccess: true,
        prescriptions: []
      }
    },
    {
      description: "responds with success when data passed in with a terminal status 'completed'",
      event: {
        schemaVersion: 1,
        prescriptions: [
          {
            prescriptionID: "abc",
            odsCode: "123"
          }
        ]
      },
      mockReply: {
        Count: 1,
        Items: [
          {
            PrescriptionID: "abc",
            LineItemID: "item_1",
            Status: "latest_status",
            TerminalStatus: "completed",
            LastModified: "1970-01-01T00:00:00Z"
          }
        ]
      },
      expectedResponse: {
        schemaVersion: 1,
        isSuccess: true,
        prescriptions: [
          {
            prescriptionID: "abc",
            onboarded: true,
            items: [
              {
                itemId: "item_1",
                latestStatus: "latest_status",
                isTerminalState: true,
                lastUpdateDateTime: "1970-01-01T00:00:00Z"
              }
            ]
          }
        ]
      }
    },
    {
      description: "responds with success when data passed in with a terminal status 'in-progress'",
      event: {
        schemaVersion: 1,
        prescriptions: [
          {
            prescriptionID: "abc",
            odsCode: "123"
          }
        ]
      },
      mockReply: {
        Count: 1,
        Items: [
          {
            PrescriptionID: "abc",
            LineItemID: "item_1",
            Status: "latest_status",
            TerminalStatus: "in-progress",
            LastModified: "1970-01-01T00:00:00Z"
          }
        ]
      },
      expectedResponse: {
        schemaVersion: 1,
        isSuccess: true,
        prescriptions: [
          {
            prescriptionID: "abc",
            onboarded: true,
            items: [
              {
                itemId: "item_1",
                latestStatus: "latest_status",
                isTerminalState: false,
                lastUpdateDateTime: "1970-01-01T00:00:00Z"
              }
            ]
          }
        ]
      }
    }
  ]

  testCases.forEach(({description, event, mockReply, expectedResponse}) => {
    it.skip(description, async () => {
      if (mockReply) {
        jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)
      }
      const response = await handler(event, dummyContext)
      expect(response).toMatchObject(expectedResponse)
    })
  })
})
