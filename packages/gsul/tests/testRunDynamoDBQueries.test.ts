import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {getItemsUpdatesForPrescription} from "../src/dynamoDBclient"
import {Logger} from "@aws-lambda-powertools/logger"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

const logger = new Logger({serviceName: "GSUL_TEST"})

describe("testing dynamoDBClient", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    const mockReply = {
      Count: 1,
      Items: [
        {
          PrescriptionID: "abc",
          LineItemID: "item_1",
          Status: "latest_status",
          TerminalStatus: "is_terminal_status",
          LastModified: "1970-01-01T00:00:00Z"
        }
      ]
    }
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)
  })

  it("should call dynamo once and return expected items", async () => {
    const queryResults = await getItemsUpdatesForPrescription("prescriptionID", "odsCode", logger)

    expect(DynamoDBDocumentClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(queryResults).toMatchObject([
      {
        itemId: "item_1",
        latestStatus: "latest_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      }
    ])
  })
})

describe("testing pagination in dynamoDBClient", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    const mockFirstReply = {
      Count: 1,
      Items: [
        {
          PrescriptionID: "abc",
          LineItemID: "item_1",
          Status: "first_status",
          TerminalStatus: "is_terminal_status",
          LastModified: "1970-01-01T00:00:00Z"
        }
      ],
      LastEvaluatedKey: {
        PharmacyODSCode: "C9Z1O",
        RequestID: "d90b88b-9cc8-4b70-9d9f-0144adcc38cc",
        PrescriptionID: "16B2E0-A83008-81C13H"
      }
    }
    const mockSecondReply = {
      Count: 1,
      Items: [
        {
          PrescriptionID: "abc",
          LineItemID: "item_1",
          Status: "second_status",
          TerminalStatus: "is_terminal_status",
          LastModified: "1970-01-01T00:00:00Z"
        }
      ]
    }
    jest
      .spyOn(DynamoDBDocumentClient.prototype, "send")
      .mockResolvedValueOnce(mockFirstReply as never)
      .mockResolvedValueOnce(mockSecondReply as never)
  })

  it("should handle pagination", async () => {
    const queryResults = await getItemsUpdatesForPrescription("prescriptionID", "odsCode", logger)

    expect(queryResults).toMatchObject([
      {
        itemId: "item_1",
        latestStatus: "first_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "second_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      }
    ])
    expect(DynamoDBDocumentClient.prototype.send).toHaveBeenCalledTimes(2)
  })
})
