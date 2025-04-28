import {
  describe,
  it,
  expect,
  jest
} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {LogItemMessage, LogItemExtraInput} from "@aws-lambda-powertools/logger/lib/cjs/types/Logger"
import {SendMessageBatchCommand} from "@aws-sdk/client-sqs"

import {createMockDataItem, mockSQSClient} from "./utils/testUtils"

const {mockSend} = mockSQSClient()

const {pushPrescriptionToNotificationSQS, saltedHash} = await import("../src/utils/sqsClient")
const {checkSiteOrSystemIsNotifyEnabled} = await import("../src/validation/notificationSiteAndSystemFilters")

const ORIGINAL_ENV = {...process.env}

describe("Unit tests for pushPrescriptionToNotificationSQS", () => {
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Reset environment
    process.env = {...ORIGINAL_ENV}

    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
  })

  it("throws if the SQS URL is not configured", async () => {
    process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL = undefined
    // Re-import the function so the environment change gets picked up
    const {pushPrescriptionToNotificationSQS: tempFunc} = await import("../src/utils/sqsClient")

    await expect(
      tempFunc("req-123", [], logger)
    ).rejects.toThrow("Notifications SQS URL not configured")

    expect(errorSpy).toHaveBeenCalledWith(
      "Notifications SQS URL not found in environment variables"
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does nothing when there are no eligible statuses", async () => {
    const data = [
      createMockDataItem({Status: "foo"}),
      createMockDataItem({Status: "bar"}),
      createMockDataItem({Status: "baz"})
    ]

    await expect(
      pushPrescriptionToNotificationSQS("req-456", data, logger)
    ).resolves.toBeUndefined()

    // It logs the initial push attempt, but never actually sends
    expect(infoSpy).toHaveBeenCalledWith(
      "Pushing data items up to the notifications SQS",
      {count: data.length, sqsUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends only 'ready to collect' messages and succeeds", async () => {
    const payload = [
      createMockDataItem({Status: "ready to collect"}),
      createMockDataItem({Status: "ready to collect - partial"}),
      createMockDataItem({Status: "a status that will never be real"})
    ]

    mockSend.mockImplementationOnce(() => Promise.resolve({Successful: [{}], Failed: [{}]}))

    await expect(
      pushPrescriptionToNotificationSQS("req-789", payload, logger)
    ).resolves.toBeUndefined()

    // Should have attempted exactly one SendMessageBatch call
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Grab the SendMessageBatchCommand that was sent
    const sent = mockSend.mock.calls[0][0]
    expect(sent).toBeInstanceOf(SendMessageBatchCommand)
    if (!(sent instanceof SendMessageBatchCommand)) {
      throw new Error("Expected a SendMessageBatchCommand")
    }
    const entries = sent.input.Entries!

    expect(entries).toHaveLength(2)

    entries.forEach((entry, idx) => {
      const original = payload[idx]
      expect(entry.Id).toBe(idx.toString())
      expect(entry.MessageBody).toBe(
        JSON.stringify({...original})
      )
      // FIFO params
      expect(entry.MessageGroupId).toBe("req-789")
      expect(entry.MessageDeduplicationId).toBe(
        saltedHash(`${original.PatientNHSNumber}:${original.PharmacyODSCode}`)
      )
    })

    expect(infoSpy).toHaveBeenCalledWith(
      "Notification required. Pushing prescriptions with deduplication IDs",
      expect.objectContaining({requestId: "req-789", deduplicationIds: expect.any(Array)})
    )
    expect(infoSpy).toHaveBeenCalledWith(
      "Successfully sent a batch of prescriptions to the notifications SQS",
      {result: {Successful: [{}], Failed: [{}]}}
    )
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send a batch of prescriptions to the notifications SQS",
      {result: {Successful: [{}], Failed: [{}]}}
    )
  })

  it("rethrows and logs if SendMessageBatchCommand rejects", async () => {
    const payload = [createMockDataItem({Status: "ready to collect"})]
    const testError = new Error("SQS failure")

    mockSend.mockImplementationOnce(() => Promise.reject(testError))

    await expect(
      pushPrescriptionToNotificationSQS("req-000", payload, logger)
    ).rejects.toThrow(testError)

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send a batch of prescriptions to the notifications SQS",
      {error: testError}
    )
  })

  it("chunks large payloads into batches of 10", async () => {
    const payload = Array.from({length: 12}, () =>
      createMockDataItem({Status: "ready to collect"})
    )

    mockSend
      .mockImplementationOnce(() => Promise.resolve({Successful: Array(10).fill({})}))
      .mockImplementationOnce(() => Promise.resolve({Successful: Array(2).fill({})}))

    await pushPrescriptionToNotificationSQS("req-111", payload, logger)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })
})

describe("Unit tests for checkSiteOrSystemIsNotifyEnabled", () => {
  it("includes an item with an enabled ODS code", () => {
    const item = createMockDataItem({
      PharmacyODSCode: "FA565",
      ApplicationName: "not a real test supplier"
    })
    const result = checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([item])
  })

  it("includes an item with an enabled ApplicationName", () => {
    const item = createMockDataItem({
      PharmacyODSCode: "ZZZ999",
      ApplicationName: "Internal Test System"
    })
    const result = checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([item])
  })

  it("is case insensitive for both ODS code and ApplicationName", () => {
    const item1 = createMockDataItem({
      PharmacyODSCode: "FA565",
      ApplicationName: "not a real test supplier"
    })
    const item2 = createMockDataItem({
      PharmacyODSCode: "zzz999",
      ApplicationName: "internal test SYSTEM"
    })
    const result = checkSiteOrSystemIsNotifyEnabled([item1, item2])
    console.log(result)
    expect(result).toEqual([item1, item2])
  })

  it("excludes an item when its ODS code is blocked, even if otherwise enabled", () => {
    const item = createMockDataItem({
      PharmacyODSCode: "A83008",
      ApplicationName: "Internal Test System"
    })
    const result = checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([])
  })

  it("excludes items that are neither enabled nor blocked", () => {
    const item = createMockDataItem({
      PharmacyODSCode: "NOTINLIST",
      ApplicationName: "Some Other System"
    })
    const result = checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([])
  })
})
