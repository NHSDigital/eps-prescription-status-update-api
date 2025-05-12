import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

import {constructPSUDataItem, constructPSUDataItemMessage} from "./testHelpers"

const mockAddPrescriptionMessagesToNotificationStateStore = jest.fn()
const mockClearCompletedSQSMessages = jest.fn()
const mockDrainQueue = jest.fn()
const mockCheckCooldownForUpdate = jest.fn()

jest.unstable_mockModule(
  "../src/utils",
  async () => ({
    __esModule: true,
    drainQueue: mockDrainQueue,
    addPrescriptionMessagesToNotificationStateStore: mockAddPrescriptionMessagesToNotificationStateStore,
    clearCompletedSQSMessages: mockClearCompletedSQSMessages,
    checkCooldownForUpdate: mockCheckCooldownForUpdate
  })
)

const mockInfo = jest.fn()
const mockError = jest.fn()
jest.unstable_mockModule(
  "@aws-lambda-powertools/logger",
  async () => ({
    __esModule: true,
    Logger: jest.fn().mockImplementation(() => ({
      info: mockInfo,
      error: mockError
    }))
  })
)

let lambdaHandler: typeof import("../src/nhsNotifyLambda").lambdaHandler
beforeAll(async () => {
  ({lambdaHandler} = await import("../src/nhsNotifyLambda"))
})

import {mockEventBridgeEvent} from "@PrescriptionStatusUpdate_common/testing"

const ORIGINAL_ENV = {...process.env}

describe("Unit test for NHS Notify lambda handler", () => {
  afterEach(() => {
    process.env = {...ORIGINAL_ENV}

    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("When drainQueue throws an error, the handler throws an error", async () => {
    mockDrainQueue.mockImplementation(() => Promise.reject(new Error("Failed")))
    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Failed")
  })

  it("When drainQueue returns no messages, the request succeeds", async () => {
    mockDrainQueue.mockImplementation(() => Promise.resolve([]))
    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockCheckCooldownForUpdate).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith("No messages to process")
  })

  it("Clears completed messages after successful processing", async () => {
    const item1 = constructPSUDataItem({TaskID: "t1", RequestID: "r1"})
    const item2 = constructPSUDataItem({TaskID: "t2", RequestID: "r2"})
    const msg1 = constructPSUDataItemMessage({PSUDataItem: item1})
    const msg2 = constructPSUDataItemMessage({PSUDataItem: item2})
    // drainQueue returns two messages
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve([msg1, msg2]))
    // deletion succeeds
    mockClearCompletedSQSMessages.mockImplementationOnce(() => Promise.resolve(undefined))
    // Checking cooldown
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockCheckCooldownForUpdate).toHaveBeenCalledTimes(2)

    // ensure we logged the fetched notifications
    expect(mockInfo).toHaveBeenCalledWith(
      "Fetched prescription notification messages",
      {
        count: 2,
        toNotify: [
          {RequestID: "r1", TaskId: "t1", Message: "Notification Required"},
          {RequestID: "r2", TaskId: "t2", Message: "Notification Required"}
        ]
      }
    )
    // ensure clearCompletedSQSMessages was called with the original messages array
    expect(mockClearCompletedSQSMessages).toHaveBeenCalledWith(
      expect.any(Object), // the logger instance
      [msg1, msg2]
    )
  })

  it("Throws and logs if clearCompletedSQSMessages fails", async () => {
    const item = constructPSUDataItem({TaskID: "tx", RequestID: "rx"})
    const msg = constructPSUDataItemMessage({PSUDataItem: item})
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve([msg]))
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))

    const deletionError = new Error("Delete failed")
    mockClearCompletedSQSMessages.mockImplementationOnce(() => Promise.reject(deletionError))

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Delete failed")

    expect(mockError).toHaveBeenCalledWith(
      "Error while deleting successfully processed messages from SQS",
      {error: deletionError}
    )
  })

  it("Throws and logs if addPrescriptionMessagesToNotificationStateStore fails", async () => {
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve([constructPSUDataItemMessage()]))
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))
    const thrownError = new Error("Failed")
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementationOnce(
      () => Promise.reject(thrownError)
    )

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Failed")
    expect(mockError).toHaveBeenCalledWith(
      "Error while pushing data to the PSU notification state data store",
      {err: thrownError}
    )
  })

  it("When drainQueue returns only valid messages, all are processed", async () => {
    const validItem = constructPSUDataItem({
      PrescriptionID: "abc123",
      TaskID: "task-1",
      RequestID: "req-1"
    })
    const message = constructPSUDataItemMessage({PSUDataItem: validItem})
    mockDrainQueue.mockImplementation(() =>
      Promise.resolve([message])
    )
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockError).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith(
      "Fetched prescription notification messages",
      {
        count: 1,
        toNotify: [
          {
            RequestID: "req-1",
            TaskId: "task-1",
            Message: "Notification Required"
          }
        ]
      }
    )
  })

  it("Filters out messages inside cooldown", async () => {
    const fresh = constructPSUDataItem({RequestID: "fresh", TaskID: "t1"})
    const stale = constructPSUDataItem({RequestID: "stale", TaskID: "t2"})
    const msgFresh = constructPSUDataItemMessage({PSUDataItem: fresh})
    const msgStale = constructPSUDataItemMessage({PSUDataItem: stale})

    mockDrainQueue.mockImplementation(() => Promise.resolve([msgFresh, msgStale]))

    // returns true if the request ID is "fresh"
    mockCheckCooldownForUpdate.mockImplementation((logger, update) => {
      const u = update as { RequestID: string }
      return Promise.resolve(u.RequestID === "fresh")
    })

    mockClearCompletedSQSMessages.mockImplementation(() => Promise.resolve())
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    // we should only persist & delete the fresh one
    expect(mockAddPrescriptionMessagesToNotificationStateStore)
      .toHaveBeenCalledWith(expect.any(Object), [msgFresh])

    expect(mockClearCompletedSQSMessages)
      .toHaveBeenCalledWith(expect.any(Object), [msgFresh])

    // and log how many were suppressed
    expect(mockInfo).toHaveBeenCalledWith(
      "Suppressed 1 messages due to cooldown",
      {suppressedCount: 1, totalFetched: 2}
    )
  })

  it("Logs a message when all messages are inside cooldown", async () => {
    const stale = constructPSUDataItem({RequestID: "stale", TaskID: "t1"})
    const msgStale = constructPSUDataItemMessage({PSUDataItem: stale})

    mockDrainQueue.mockImplementation(() => Promise.resolve([msgStale]))

    // returns true if the request ID is "fresh"
    mockCheckCooldownForUpdate.mockImplementation((logger, update) => {
      const u = update as { RequestID: string }
      return Promise.resolve(u.RequestID === "fresh")
    })

    mockClearCompletedSQSMessages.mockImplementation(() => Promise.resolve())
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockAddPrescriptionMessagesToNotificationStateStore).not.toHaveBeenCalled()
    expect(mockClearCompletedSQSMessages).not.toHaveBeenCalled()

    // and log that everything was suppressed
    expect(mockInfo)
      .toHaveBeenCalledWith(
        "All messages suppressed by cooldown; nothing to notify",
        {suppressedCount: 1, totalFetched: 1}
      )
  })
})
