import {
  describe,
  it,
  expect,
  jest
} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {LogItemMessage, LogItemExtraInput} from "@aws-lambda-powertools/logger/lib/cjs/types/Logger"
import {SendMessageBatchCommand, DeleteMessageBatchCommand} from "@aws-sdk/client-sqs"

import {createMockDataItem, mockSQSClient} from "./utils/testUtils"

const {mockSend} = mockSQSClient()

const mockGetSecret = jest.fn().mockImplementation(async () => {
  return {"salt": "salt"}
})
jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/secrets",
  async () => ({
    __esModule: true,
    getSecret: mockGetSecret
  })
)

const mockGetParameter = jest.fn().mockImplementation((name) => {
  if (!name) throw new Error("No parameter requested")
  else if (name === "ENABLED_SITE_ODS_CODES_PARAM") {
    return "FA565"
  } else if (name === "ENABLED_SYSTEMS_PARAM") {
    return "Internal Test System,Apotec Ltd - Apotec CRM - Production,CrxPatientApp,nhsPrescriptionApp,Titan PSU Prod"
  } else if (name === "BLOCKED_SITE_ODS_CODES_PARAM") {
    return "B3J1Z"
  }
  return "parameter_value"
})
jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/ssm",
  async () => ({
    __esModule: true,
    getParameter: mockGetParameter
  })
)

const {
  pushPrescriptionToNotificationSQS,
  removeSqsMessages,
  saltedHash
} = await import("../src/utils/sqsClient")
const {checkSiteOrSystemIsNotifyEnabled} = await import("../src/validation/notificationSiteAndSystemFilters")

const ORIGINAL_ENV = {...process.env}

describe("Unit tests for pushPrescriptionToNotificationSQS", () => {
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let warnSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Reset environment
    process.env = {...ORIGINAL_ENV}

    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
    warnSpy = jest.spyOn(logger, "warn")
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
    ).resolves.toEqual([])

    // It logs the initial push attempt, but never actually sends
    expect(infoSpy).toHaveBeenCalledWith(
      "Checking if any items require notifications",
      {numItemsToBeChecked: data.length, sqsUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends only 'ready to collect' messages and succeeds", async () => {
    const payload = [
      createMockDataItem({Status: "rEaDy To CoLlEcT"}), // Test case-insensitivity
      createMockDataItem({Status: "ready to collect - partial"}),
      createMockDataItem({Status: "a status that will never be real"})
    ]

    mockSend.mockImplementationOnce(() => Promise.resolve({Successful: [{}], Failed: [{}]}))

    await expect(
      pushPrescriptionToNotificationSQS("req-789", payload, logger)
    ).resolves.toEqual([])

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
        saltedHash(`${original.PatientNHSNumber}:${original.PharmacyODSCode}`, "salt")
      )
    })

    expect(infoSpy).toHaveBeenCalledWith(
      "Notification required. Pushing prescriptions to the notifications SQS with the following SQS message IDs",
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

  it("Uses the fallback salt value but logs a warning about it", async () => {
    mockGetSecret.mockImplementationOnce(async () => {
      return "DEV SALT"
    })

    await pushPrescriptionToNotificationSQS("req-123", [], logger)

    expect(warnSpy)
      .toHaveBeenCalledWith(
        "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
      )
  })
})
describe("Unit tests for getSaltValue", () => {
  let getSaltValue: (logger: Logger) => Promise<string>
  let logger: Logger
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let warnSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  const fallbackSalt = "DEV SALT"

  beforeEach(async () => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = {...ORIGINAL_ENV}

    logger = new Logger({serviceName: "test-service"})
    errorSpy = jest.spyOn(logger, "error")
    warnSpy = jest.spyOn(logger, "warn")

    // re-import the function after resetModules so mocks are applied
    ;({getSaltValue} = await import("../src/utils/sqsClient"))
  })

  it("returns the fallback salt when SQS_SALT is not configured", async () => {
    delete process.env.SQS_SALT

    const salt = await getSaltValue(logger)
    expect(salt).toBe(fallbackSalt)
    expect(warnSpy).toHaveBeenCalledWith(
      "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
    )
  })

  it("returns the secret salt when secret has a valid salt field", async () => {
    process.env.SQS_SALT = "someSecret"
    mockGetSecret.mockImplementationOnce(async () => ({salt: "real-salt"}))

    const salt = await getSaltValue(logger)
    expect(salt).toBe("real-salt")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("falls back and logs an error when secret is missing the salt field", async () => {
    process.env.SQS_SALT = "someSecret"
    const badValue = {notSalt: "value"}
    mockGetSecret.mockImplementationOnce(async () => badValue)

    const salt = await getSaltValue(logger)
    expect(salt).toBe(fallbackSalt)
    expect(errorSpy).toHaveBeenCalledWith(
      "Secret did not contain a valid salt field, falling back to DEV SALT",
      {secretValue: badValue}
    )
    expect(warnSpy).toHaveBeenCalledWith(
      "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
    )
  })

  it("falls back and logs an error when getSecret throws", async () => {
    process.env.SQS_SALT = "someSecret"
    const testErr = new Error("failure")
    mockGetSecret.mockImplementationOnce(async () => {
      throw testErr
    })

    const salt = await getSaltValue(logger)
    expect(salt).toBe(fallbackSalt)
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to fetch SQS_SALT from Secrets Manager, using DEV SALT",
      {error: testErr}
    )
    expect(warnSpy).toHaveBeenCalledWith(
      "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
    )
  })
})
describe("Unit tests for checkSiteOrSystemIsNotifyEnabled", () => {
  it("includes an item with an enabled ODS code", async () => {
    const item = createMockDataItem({
      PharmacyODSCode: "FA565",
      ApplicationName: "not a real test supplier"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([item])
  })

  it("includes an item with an enabled ApplicationName", async() => {
    const item = createMockDataItem({
      PharmacyODSCode: "ZZZ999",
      ApplicationName: "Internal Test System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([item])
  })

  it("is case insensitive for both ODS code and ApplicationName", async() => {
    const item1 = createMockDataItem({
      PharmacyODSCode: "fa565",
      ApplicationName: "not a real test supplier"
    })
    const item2 = createMockDataItem({
      PharmacyODSCode: "zzz999",
      ApplicationName: "internal test SYSTEM"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([item1, item2])
    console.log(result)
    expect(result).toEqual([item1, item2])
  })

  it("excludes an item when its ODS code is blocked, even if otherwise enabled", async() => {
    const item = createMockDataItem({
      PharmacyODSCode: "b3j1z",
      ApplicationName: "Internal Test System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([])
  })

  it("excludes items that are neither enabled nor blocked", async () => {
    const item = createMockDataItem({
      PharmacyODSCode: "NOTINLIST",
      ApplicationName: "Some Other System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([item])
    expect(result).toEqual([])
  })

})

describe("Unit tests for removeSqsMessages", () => {
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>

  beforeEach(async () => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env = {...ORIGINAL_ENV}
    process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL = "https://queue.url"

    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
  })

  it("throws if the SQS URL is not configured", async () => {
    delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
    const {removeSqsMessages: tempFunc} = await import("../src/utils/sqsClient")
    await expect(
      tempFunc(logger, ["rh1"])
    ).rejects.toThrow("Notifications SQS URL not configured")

    expect(errorSpy).toHaveBeenCalledWith(
      "Notifications SQS URL not found in environment variables"
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does nothing when there are no receipt handles", async () => {
    await expect(
      removeSqsMessages(logger, [])
    ).resolves.toBeUndefined()

    expect(infoSpy).toHaveBeenCalledWith(
      "Removing SQS messages from the queue",
      {receiptHandles: []}
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("deletes messages in batches of 10 and logs successes and failures", async () => {
    const handles = Array.from({length: 12}, (_, i) => `rh${i}`)
    const firstResult = {
      Successful: Array.from({length: 10}, (_, i) => ({Id: i.toString()})),
      Failed: Array.from({length: 2}, (_, i) => ({Id: (10 + i).toString(), SenderFault: false}))
    }
    mockSend
      .mockImplementationOnce(() => Promise.resolve(firstResult))
      .mockImplementationOnce(() => Promise.resolve({Successful: [], Failed: []}))

    await removeSqsMessages(logger, handles)

    expect(mockSend).toHaveBeenCalledTimes(2)

    const firstCall = mockSend.mock.calls[0][0]
    expect(firstCall).toBeInstanceOf(DeleteMessageBatchCommand)
    if (firstCall instanceof DeleteMessageBatchCommand) {
      expect(firstCall.input.Entries).toHaveLength(10)
      expect(infoSpy).toHaveBeenCalledWith(
        "Successfully removed messages from the SQS queue",
        {successfulIds: expect.arrayContaining(firstResult.Successful.map(r => r.Id))}
      )
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to remove some messages from the SQS queue",
        {failures: firstResult.Failed}
      )
    }

    const secondCall = mockSend.mock.calls[1][0]
    expect(secondCall).toBeInstanceOf(DeleteMessageBatchCommand)
    if (secondCall instanceof DeleteMessageBatchCommand) {
      expect(secondCall.input.Entries).toHaveLength(2)
    }
  })
})
