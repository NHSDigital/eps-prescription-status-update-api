import {jest} from "@jest/globals"

import * as sqs from "@aws-sdk/client-sqs"

import {DataItem} from "../src/types"

// Similarly mock the SQS client
export function mockSQSClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-sqs", () => {
    return {
      ...sqs,
      SQSClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

export function constructDataItem(overrides: Partial<DataItem> = {}): DataItem {
  return {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "mnopqr-ghijkl-abcdef",
    TerminalStatus: "ready to collect",
    ApplicationName: "Jim's Pills",
    ExpiryTime: 123,
    ...overrides
  }
}
