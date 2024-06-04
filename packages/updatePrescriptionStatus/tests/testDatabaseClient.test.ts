/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {DEFAULT_DATE, mockDynamoDBClient} from "./utils/testUtils"

import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"

const {mockSend} = mockDynamoDBClient()
const {persistDataItems} = await import("../src/utils/databaseClient")

describe("Integration tests for updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
    jest.clearAllTimers()
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
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
        message: "transaction cancelled."
      }) as never
    )

    expect(async () => await persistDataItems(dataItems)).toThrow(TransactionCanceledException)
  })
})
