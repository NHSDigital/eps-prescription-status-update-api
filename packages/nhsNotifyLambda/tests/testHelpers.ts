import {jest} from "@jest/globals"

import * as sqs from "@aws-sdk/client-sqs"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import {PSUDataItemMessage} from "../src/utils"

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

export function constructMessage(overrides: Partial<sqs.Message> = {}): sqs.Message {
  return {
    MessageId: "messageId",
    Body: JSON.stringify(constructPSUDataItem()),
    ...overrides
  }
}

export function constructPSUDataItemMessage(overrides: Partial<PSUDataItemMessage> = {}): PSUDataItemMessage {
  return {
    ...constructMessage(),
    PSUDataItem: constructPSUDataItem(),
    ...overrides
  }
}

export function constructPSUDataItem(overrides: Partial<PSUDataItem> = {}): PSUDataItem {
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
