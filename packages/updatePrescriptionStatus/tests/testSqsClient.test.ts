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

export const mockGetParametersByName = jest.fn(async () => {
  // eslint-disable-next-line max-len
  let enabledString: string = "Internal Test System,Apotec Ltd - Apotec CRM - Production,CrxPatientApp,nhsPrescriptionApp,Titan PSU Prod"
  return {
    [process.env.ENABLED_SITE_ODS_CODES_PARAM!]: "FA565",
    [process.env.ENABLED_SYSTEMS_PARAM!]: enabledString,
    [process.env.BLOCKED_SITE_ODS_CODES_PARAM!]: "B3J1Z"
  }
})

const mockInitiatedSSMProvider = {
  getParametersByName: mockGetParametersByName
}

jest.unstable_mockModule("@psu-common/utilities", async () => ({
  initiatedSSMProvider: mockInitiatedSSMProvider
}))

const {
  pushPrescriptionToNotificationSQS,
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

  it("throws if the post-dated SQS URL is not configured", async () => {
    process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = undefined
    const {pushPrescriptionToNotificationSQS: tempFunc} = await import("../src/utils/sqsClient")

    await expect(
      tempFunc("req-123", [], logger)
    ).rejects.toThrow("Post-dated Notifications SQS URL not configured")

    expect(warnSpy).toHaveBeenCalledWith(
      "Post-dated Notifications SQS URL not found in environment variables"
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("does nothing when there are no eligible statuses", async () => {
    const data = [
      {
        current: createMockDataItem({Status: "foo_previous"}),
        previous: createMockDataItem({Status: "foo"})
      },
      {
        current: createMockDataItem({Status: "bar_previous"}),
        previous: createMockDataItem({Status: "bar"})
      },
      {
        current: createMockDataItem({Status: "baz_previous"}),
        previous: createMockDataItem({Status: "baz"})
      }
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

  it("filters out ready to collect items whose status has not changed", async () => {
    const data = [
      {
        current: createMockDataItem({Status: "ready to collect"}),
        previous: createMockDataItem({Status: "ready to collect"})
      },
      {
        current: createMockDataItem({Status: "READY TO COLLECT - PARTIAL"}),
        previous: createMockDataItem({Status: "ready to collect - partial"})
      }
    ]

    await expect(
      pushPrescriptionToNotificationSQS("req-no-change", data, logger)
    ).resolves.toEqual([])

    expect(mockSend).not.toHaveBeenCalled()
  })

  it("sends only 'ready to collect' messages and succeeds", async () => {
    const payload = [
      {
        previous: createMockDataItem({Status: "Old Status"}), // Test case-insensitivity
        current: createMockDataItem({Status: "rEaDy To CoLlEcT"})
      },
      {
        previous: createMockDataItem({Status: "Old Status"}),
        current: createMockDataItem({Status: "ready to collect - partial"})
      },
      {
        previous: createMockDataItem({Status: "Old Status"}),
        current: createMockDataItem({Status: "a status that will never be real"})
      }
    ]

    mockSend.mockImplementationOnce(() => Promise.resolve({Successful: [{}]}))

    await expect(
      pushPrescriptionToNotificationSQS("req-789", payload, logger)
    ).resolves.toEqual([])

    // Should have attempted exactly one SendMessageBatch call
    expect(mockSend).toHaveBeenCalledTimes(1)

    // Grab the SendMessageBatchCommand that was sent
    const sent = mockSend.mock.calls[0][0]
    expect(sent).toBeInstanceOf(SendMessageBatchCommand)
    if (!(sent instanceof SendMessageBatchCommand)) {
      throw new TypeError("Expected a SendMessageBatchCommand")
    }
    const entries = sent.input.Entries!

    expect(entries).toHaveLength(2)

    entries.forEach((entry, idx) => {
      const original = payload[idx]
      expect(entry.Id).toBe(idx.toString())
      expect(entry.MessageBody).toBe(
        JSON.stringify({...original.current})
      )
      // FIFO params
      expect(entry.MessageGroupId).toBe("req-789")
      expect(entry.MessageDeduplicationId).toBe(
        saltedHash(`${original.current.PatientNHSNumber}:${original.current.PharmacyODSCode}`, "salt")
      )
    })

    expect(infoSpy).toHaveBeenCalledWith(
      "Successfully sent a batch of prescriptions to the SQS",
      {result: {Successful: [{}]}, queueUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
  })

  it("routes post-dated and standard notifications to their respective queues", async () => {
    const postDatedCurrent = createMockDataItem({
      Status: "ready to collect",
      PatientNHSNumber: "9999999999",
      PharmacyODSCode: "JIM123",
      PostDatedLastModifiedSetAt: "2100-01-01T00:00:00Z"
    })
    const standardCurrent = createMockDataItem({
      Status: "ready to collect - partial",
      PatientNHSNumber: "8888888888",
      PharmacyODSCode: "JIM123"
    })
    const payload = [
      {previous: createMockDataItem({Status: "previous status"}), current: postDatedCurrent},
      {previous: createMockDataItem({Status: "previous status"}), current: standardCurrent}
    ]

    mockSend
      .mockImplementationOnce(() => Promise.resolve({Successful: [{MessageId: "pd-id"}]}))
      .mockImplementationOnce(() => Promise.resolve({Successful: [{MessageId: "std-id"}]}))

    const result = await pushPrescriptionToNotificationSQS("req-mixed", payload, logger)

    expect(result).toEqual(["pd-id", "std-id"]) // Both have been pushed to SQS, so we get their IDs
    expect(mockSend).toHaveBeenCalledTimes(2)

    // Check that the send command was called twice, once with each SQS URL
    const queueUrls = mockSend.mock.calls.map(call => {
      const command = call[0]
      expect(command).toBeInstanceOf(SendMessageBatchCommand)
      if (!(command instanceof SendMessageBatchCommand)) {
        throw new TypeError("Expected a SendMessageBatchCommand")
      }
      command.input.Entries!.forEach(entry => {
        expect(entry.MessageGroupId).toBe("req-mixed")
      })
      return command.input.QueueUrl
    })

    expect(queueUrls).toEqual(
      expect.arrayContaining([
        process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL,
        process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      ])
    )
  })

  it("rethrows and logs if SendMessageBatchCommand rejects", async () => {
    const payload = [
      {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({Status: "ready to collect"})
      }
    ]
    const testError = new Error("SQS failure")

    mockSend.mockImplementationOnce(() => Promise.reject(testError))

    await expect(
      pushPrescriptionToNotificationSQS("req-000", payload, logger)
    ).rejects.toThrow(testError)

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send a batch of prescriptions to the SQS",
      {error: testError, queueUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
  })

  it("rejects when the standard queue fails but the post-dated queue succeeds", async () => {
    const payload = [
      {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({
          Status: "ready to collect",
          PatientNHSNumber: "444",
          PharmacyODSCode: "DDD",
          PostDatedLastModifiedSetAt: "2025-05-01T00:00:00Z"
        })
      },
      {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({Status: "ready to collect", PatientNHSNumber: "555", PharmacyODSCode: "EEE"})
      }
    ]
    const standardQueueError = new Error("Standard queue failure")

    mockSend
      .mockImplementationOnce(() => Promise.resolve({Successful: [{MessageId: "pd-ok"}]}))
      .mockImplementationOnce(() => Promise.reject(standardQueueError))

    await expect(
      pushPrescriptionToNotificationSQS("req-failure", payload, logger)
    ).rejects.toThrow(standardQueueError)

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send a batch of prescriptions to the SQS",
      {error: standardQueueError, queueUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
  })

  it("Rejects when the post-dated queue fails but the standard queue succeeds", async () => {
    const payload = [
      {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({
          Status: "ready to collect",
          PatientNHSNumber: "777",
          PharmacyODSCode: "GGG",
          PostDatedLastModifiedSetAt: "2100-12-12T00:00:00Z"
        })
      },
      {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({Status: "ready to collect", PatientNHSNumber: "888", PharmacyODSCode: "HHH"})
      }
    ]
    const postDatedQueueError = new Error("Post-dated queue failure")

    mockSend
      .mockImplementationOnce(() => Promise.reject(postDatedQueueError))
      .mockImplementationOnce(() => Promise.resolve({Successful: [{MessageId: "std-ok"}]}))

    await expect(
      pushPrescriptionToNotificationSQS("req-failure-2", payload, logger)
    ).rejects.toThrow(postDatedQueueError)
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send a batch of prescriptions to the SQS",
      {error: postDatedQueueError, queueUrl: process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL}
    )
  })

  it("chunks large payloads into batches of 10", async () => {
    const payload = Array.from({length: 12}, () => {
      return {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({Status: "ready to collect"})
      }
    })

    mockSend
      .mockImplementationOnce(() => Promise.resolve({Successful: new Array(10).fill({})}))
      .mockImplementationOnce(() => Promise.resolve({Successful: new Array(2).fill({})}))

    await pushPrescriptionToNotificationSQS("req-111", payload, logger)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("Uses the fallback salt value but logs a warning about it", async () => {
    mockGetSecret.mockImplementationOnce(async () => {
      return {"salt": "DEV SALT"}
    })

    const payload = Array.from({length: 1}, () => {
      return {
        previous: createMockDataItem({Status: "previous status"}),
        current: createMockDataItem({Status: "ready to collect"})
      }
    })
    mockSend.mockImplementationOnce(() => Promise.resolve({Successful: new Array(2).fill({})}))

    await pushPrescriptionToNotificationSQS("req-123", payload, logger)

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
    warnSpy = jest.spyOn(logger, "warn");

    ({getSaltValue} = await import("../src/utils/sqsClient"))
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
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  beforeEach(() => {
    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
  })

  it("includes an item with an enabled ODS code", async () => {
    const previous = createMockDataItem({
      PharmacyODSCode: "FA565",
      ApplicationName: "not a real test supplier",
      Status: "previous"
    })
    const current = createMockDataItem({
      PharmacyODSCode: "FA565",
      ApplicationName: "not a real test supplier"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([{previous, current}], logger)
    expect(result).toStrictEqual([{previous, current}])
    expectLogReceivedAndAllowed(infoSpy, 1, 1)
  })

  it("includes an item with an enabled ApplicationName", async () => {
    const previous = createMockDataItem({
      PharmacyODSCode: "ZZZ999",
      ApplicationName: "Internal Test System",
      Status: "previous"
    })
    const current = createMockDataItem({
      PharmacyODSCode: "ZZZ999",
      ApplicationName: "Internal Test System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([{previous, current}], logger)
    expect(result).toEqual([{previous, current}])
    expectLogReceivedAndAllowed(infoSpy, 1, 1)
  })

  it("is case insensitive for both ODS code and ApplicationName", async () => {
    const item1 = createMockDataItem({
      PharmacyODSCode: "fa565",
      ApplicationName: "not a real test supplier"
    })
    const item2 = createMockDataItem({
      PharmacyODSCode: "zzz999",
      ApplicationName: "internal test SYSTEM"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([
      {
        previous: item1,
        current: item1
      },
      {
        previous: item2,
        current: item2
      }
    ], logger)
    expect(result).toEqual([
      {
        previous: item1,
        current: item1
      },
      {
        previous: item2,
        current: item2
      }
    ])
  })

  it("excludes an item when its ODS code is blocked, even if otherwise enabled", async () => {
    const previous = createMockDataItem({
      PharmacyODSCode: "b3j1z",
      ApplicationName: "Internal Test System",
      Status: "previous"
    })
    const current = createMockDataItem({
      PharmacyODSCode: "b3j1z",
      ApplicationName: "Internal Test System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([{previous, current}], logger)
    expect(result).toEqual([])
    expectLogReceivedAndAllowed(infoSpy, 1, 0)
  })

  it("excludes items that are neither enabled nor blocked", async () => {
    const previous = createMockDataItem({
      PharmacyODSCode: "NOTINLIST",
      ApplicationName: "Some Other System",
      Status: "previous"
    })
    const current = createMockDataItem({
      PharmacyODSCode: "NOTINLIST",
      ApplicationName: "Some Other System"
    })
    const result = await checkSiteOrSystemIsNotifyEnabled([{previous, current}], logger)
    expect(result).toEqual([])
    expectLogReceivedAndAllowed(infoSpy, 1, 0)
  })

})
function expectLogReceivedAndAllowed(
  infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>,
  numItemsReceived: number,
  numItemsAllowed: number) {
  expect(infoSpy).toHaveBeenCalledWith(
    expect.stringContaining("Filtered out sites and suppliers that are not enabled, or are explicitly disabled"),
    expect.objectContaining({numItemsReceived, numItemsAllowed})
  )
}
