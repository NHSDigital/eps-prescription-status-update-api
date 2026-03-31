import {vi} from "vitest"
import type {Message} from "@aws-sdk/client-sqs"

import {PSUDataItem} from "@psu-common/commonTypes"
import {NotifyDataItemMessage} from "../src/utils"

const {mockSend} = vi.hoisted(() => ({mockSend: vi.fn()}))

vi.mock("@aws-sdk/client-sqs", async (importOriginal) => {
  const sqs = await importOriginal<typeof import("@aws-sdk/client-sqs")>()
  return {
    ...sqs,
    SQSClient: vi.fn().mockImplementation(() => ({
      send: mockSend
    }))
  }
})

// Similarly mock the SQS client
export function mockSQSClient() {
  return {mockSend}
}

export function constructMessage(overrides: Partial<Message> = {}): Message {
  return {
    MessageId: "messageId",
    Attributes: {
      MessageDeduplicationId: crypto.randomUUID()
    },
    Body: JSON.stringify(constructPSUDataItem()),
    ...overrides
  }
}

export function constructPSUDataItemMessage(overrides: Partial<NotifyDataItemMessage> = {}): NotifyDataItemMessage {
  return {
    ...constructMessage(),
    PSUDataItem: constructPSUDataItem(),
    messageBatchReference: crypto.randomUUID(),
    messageReference: crypto.randomUUID(),
    notifyMessageId: crypto.randomUUID(),
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
