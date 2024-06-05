import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
import {mockDynamoDBClient} from "./utils/testUtils"

const {mockSend} = mockDynamoDBClient()
const {persistDataItems, logger} = await import("../src/utils/databaseClient")

describe("Unit test persistDataItems", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })
  it("when the conditional check fails, an error is thrown", async () => {
    const dataItems = [
      {
        LastModified: "2023-01-01T00:00:00Z",
        LineItemID: "LineItemID_1",
        PatientNHSNumber: "PatientNHSNumber_1",
        PharmacyODSCode: "PharmacyODSCode_1",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_1",
        Status: "Status_1",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_1"
      },
      {
        LastModified: "2023-01-02T00:00:00Z",
        LineItemID: "LineItemID_2",
        PatientNHSNumber: "PatientNHSNumber_2",
        PharmacyODSCode: "PharmacyODSCode_2",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_2",
        Status: "Status_2",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_2"
      }
    ]

    mockSend.mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
      }) as never
    )
    const loggerSpy = jest.spyOn(logger, "error")

    await expect(persistDataItems(dataItems)).rejects.toThrow(
      new TransactionCanceledException({
        $metadata: {},
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
      }) as never
    )

    expect(loggerSpy).toHaveBeenCalledWith("DynamoDB transaction cancelled due to conditional check failure.", {
      reasons: [{Code: "ConditionalCheckFailedException"}]
    })
  })
})
