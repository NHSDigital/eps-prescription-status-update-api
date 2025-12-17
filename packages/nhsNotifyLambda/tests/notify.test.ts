import {jest, describe, it} from "@jest/globals"

import {Logger} from "@aws-lambda-powertools/logger"
import {logNotificationRequest} from "../src/utils/notify"
import {MessageBatchItem, NotifyDataItemMessage} from "../src/utils/types"
import {LOG_MESSAGES} from "@psu-common/utilities"

// Mock crypto.randomUUID
const mockUUID = "550e8400-e29b-41d4-a716-446655440000"
globalThis.crypto = {
  randomUUID: () => mockUUID
} as unknown as Crypto

const mockInfo = jest.fn()
const mockError = jest.fn()
const mockWarn = jest.fn()

describe("logNotificationRequest", () => {
  let mockLogger: Logger
  let messages: Array<MessageBatchItem>
  let data: Array<NotifyDataItemMessage>
  const messageBatchReference = "batch-ref-123"

  beforeEach(() => {
    mockLogger = {
      info: mockInfo,
      error: mockError,
      warn: mockWarn
    } as unknown as Logger

    messages = [
      {
        messageReference: "msg-ref-1",
        recipient: {nhsNumber: "9453740578"},
        originator: {odsCode: "FA566"},
        personalisation: {}
      },
      {
        messageReference: "msg-ref-2",
        recipient: {nhsNumber: "9912003071"},
        originator: {odsCode: "A83008"},
        personalisation: {}
      }
    ]

    const dataItem1: NotifyDataItemMessage = {
      messageReference: "msg-ref-1",
      PSUDataItem: {
        PatientNHSNumber: "9453740578",
        PharmacyODSCode: "FA566",
        RequestID: "req-1",
        TaskID: "",
        Status: ""
      },
      notifyMessageId: "notify-id-1"
    }
    const dataItem2: NotifyDataItemMessage = {
      messageReference: "msg-ref-2",
      PSUDataItem: {
        PatientNHSNumber: "9912003071",
        PharmacyODSCode: "A83008",
        RequestID: "req-2",
        TaskID: "",
        Status: ""
      },
      notifyMessageId: "notify-id-2"
    }

    data = [dataItem1, dataItem2]

    jest.clearAllMocks()
  })

  it("should log legacy notification request summary", () => {
    logNotificationRequest(mockLogger, messageBatchReference, messages, data, "requested")

    expect(mockInfo).toHaveBeenCalledWith("Requested notifications OK!", {
      messageBatchReference,
      messageReferences: [
        {nhsNumber: "9453740578", messageReference: "msg-ref-1", psuRequestId: "req-1"},
        {nhsNumber: "9912003071", messageReference: "msg-ref-2", psuRequestId: "req-2"}
      ],
      messageStatus: "requested"
    })
  })

  it("should log individual messages with correct details", () => {
    logNotificationRequest(mockLogger, messageBatchReference, messages, data, "requested")

    const expectedCode = Object.keys(LOG_MESSAGES)
      .find(key => LOG_MESSAGES[key as keyof typeof LOG_MESSAGES] === LOG_MESSAGES.PSU0002)

    expect(mockInfo).toHaveBeenCalledWith(LOG_MESSAGES.PSU0002, {
      reportCode: expectedCode,
      messageBatchReference,
      messageIndex: 0,
      nhsNumber: "9453740578",
      pharmacyOdsCode: "FA566",
      messageReference: "msg-ref-1",
      psuRequestId: "req-1",
      notifyMessageId: "notify-id-1",
      messageStatus: "requested"
    })

    expect(mockInfo).toHaveBeenCalledWith(LOG_MESSAGES.PSU0002, {
      reportCode: expectedCode,
      messageBatchReference,
      messageIndex: 1,
      nhsNumber: "9912003071",
      pharmacyOdsCode: "A83008",
      messageReference: "msg-ref-2",
      psuRequestId: "req-2",
      notifyMessageId: "notify-id-2",
      messageStatus: "requested"
    })
  })

  it("should generate UUID for notifyMessageId when messageStatus is 'silent running'", () => {
    logNotificationRequest(mockLogger, messageBatchReference, messages, data, "silent running")

    const calls = mockInfo.mock.calls.filter(call => call[0] === LOG_MESSAGES.PSU0002)

    expect(calls[0][1]).toMatchObject({
      notifyMessageId: mockUUID,
      messageStatus: "silent running"
    })

    expect(calls[1][1]).toMatchObject({
      notifyMessageId: mockUUID,
      messageStatus: "silent running"
    })
  })

  it("should handle missing corresponding data gracefully", () => {
    const messagesWithExtra = [
      ...messages,
      {
        messageReference: "msg-ref-3",
        recipient: {nhsNumber: "1111111111"},
        originator: {odsCode: "DEF456"},
        personalisation: {}
      }
    ]

    logNotificationRequest(mockLogger, messageBatchReference, messagesWithExtra, data, "requested")

    const individualLogs = mockInfo.mock.calls.filter(call => call[0] === LOG_MESSAGES.PSU0002)

    expect(individualLogs[2][1]).toMatchObject({
      pharmacyOdsCode: undefined,
      psuRequestId: undefined,
      notifyMessageId: undefined
    })
  })

  it("should log correct number of times", () => {
    logNotificationRequest(mockLogger, messageBatchReference, messages, data, "requested")

    // 1 legacy log + 2 individual message logs
    expect(mockLogger.info).toHaveBeenCalledTimes(3)
  })

  it("should handle empty messages array", () => {
    logNotificationRequest(mockLogger, messageBatchReference, [], [], "requested")

    expect(mockLogger.info).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).toHaveBeenCalledWith("Requested notifications OK!", {
      messageBatchReference,
      messageReferences: [],
      messageStatus: "requested"
    })
  })
})
