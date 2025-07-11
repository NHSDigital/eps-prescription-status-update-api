import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

import {constructPSUDataItem, constructPSUDataItemMessage} from "./testHelpers"

const mockGetParameter = jest.fn().mockImplementation(() => "parameter_value")
jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/ssm",
  async () => ({
    __esModule: true,
    getParameter: mockGetParameter
  })
)

const mockAddPrescriptionMessagesToNotificationStateStore = jest.fn()
const mockRemoveSQSMessages = jest.fn()
const mockReportQueueStatus = jest.fn()
const mockDrainQueue = jest.fn()
const mockCheckCooldownForUpdate = jest.fn()
const mockMakeBatchNotifyRequest = jest.fn()

jest.unstable_mockModule(
  "../src/utils",
  async () => ({
    __esModule: true,
    reportQueueStatus: mockReportQueueStatus,
    drainQueue: mockDrainQueue,
    addPrescriptionMessagesToNotificationStateStore: mockAddPrescriptionMessagesToNotificationStateStore,
    removeSQSMessages: mockRemoveSQSMessages,
    checkCooldownForUpdate: mockCheckCooldownForUpdate,
    makeBatchNotifyRequest: mockMakeBatchNotifyRequest
  })
)

const mockInfo = jest.fn()
const mockError = jest.fn()
const mockWarn = jest.fn()
jest.unstable_mockModule(
  "@aws-lambda-powertools/logger",
  async () => ({
    __esModule: true,
    Logger: jest.fn().mockImplementation(() => ({
      info: mockInfo,
      error: mockError,
      warn: mockWarn
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

  it("When the getParameter call fails, the handler throws an error", async () => {
    mockGetParameter.mockImplementationOnce(() => Promise.resolve(undefined))
    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("No Routing Plan ID found")
  })

  it("When drainQueue throws an error, the handler throws an error", async () => {
    mockDrainQueue.mockImplementation(() => Promise.reject(new Error("Failed")))
    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Failed")
  })

  it("When drainQueue returns no messages, the request succeeds", async () => {
    mockDrainQueue.mockImplementation(() => Promise.resolve({messages: [], isEmpty: true}))
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
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve({messages: [msg1, msg2], isEmpty: true}))
    // deletion succeeds
    mockRemoveSQSMessages.mockImplementation(() => Promise.resolve())
    // Checking cooldown
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))
    // Notify request succeeds
    mockMakeBatchNotifyRequest.mockImplementationOnce(() => Promise.resolve(
      [
        {...msg1, success: true, notifyMessageId: "message1"},
        {...msg2, success: true, notifyMessageId: "message2"}
      ]
    ))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockCheckCooldownForUpdate).toHaveBeenCalledTimes(2)
    expect(mockMakeBatchNotifyRequest).toHaveBeenCalledTimes(1)

    // ensure removeSQSMessages was called with the original messages array
    expect(mockRemoveSQSMessages).toHaveBeenCalledWith(
      expect.any(Object), // the logger instance
      [
        expect.objectContaining({
          ...msg1,
          success: true,
          notifyMessageId: expect.any(String)
        }),
        expect.objectContaining({
          ...msg2,
          success: true,
          notifyMessageId: expect.any(String)
        })
      ]
    )
  })

  it("Throws and logs if removeSQSMessages fails", async () => {
    const item = constructPSUDataItem({TaskID: "tx", RequestID: "rx"})
    const msg = constructPSUDataItemMessage({PSUDataItem: item})
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve({messages: [msg], isEmpty: true}))
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))

    // Notify request succeeds
    mockMakeBatchNotifyRequest.mockImplementationOnce(() => Promise.resolve(
      [
        {...msg, success: true, notifyMessageId: "message"}
      ]
    ))

    const deletionError = new Error("Delete failed")
    mockRemoveSQSMessages.mockImplementationOnce(() => Promise.reject(deletionError))

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Delete failed")
  })

  it("Throws and logs if addPrescriptionMessagesToNotificationStateStore fails", async () => {
    const msg = constructPSUDataItemMessage()
    mockDrainQueue.mockImplementationOnce(
      () => Promise.resolve({messages: [msg], isEmpty: true})
    )
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))
    const thrownError = new Error("Failed")
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementationOnce(
      () => Promise.reject(thrownError)
    )

    // Notify request succeeds
    mockMakeBatchNotifyRequest.mockImplementationOnce(() => Promise.resolve(
      [{...msg, success: true, notifyMessageId: "message"}]
    ))

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Failed")
  })

  it("When drainQueue returns only valid messages, all are processed", async () => {
    const validItem = constructPSUDataItem({
      PrescriptionID: "abc123",
      TaskID: "task-1",
      RequestID: "req-1"
    })
    const message = constructPSUDataItemMessage({PSUDataItem: validItem})
    mockDrainQueue.mockImplementation(
      () => Promise.resolve({messages: [message], isEmpty: true})
    )
    mockCheckCooldownForUpdate.mockImplementation(() => Promise.resolve(true))

    // Notify request succeeds
    mockMakeBatchNotifyRequest.mockImplementationOnce(() => Promise.resolve(
      [
        {...message, success: true, notifyMessageId: "message"}
      ]
    ))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    expect(mockError).not.toHaveBeenCalled()
    expect(mockGetParameter).toHaveBeenCalledWith(process.env.NHS_NOTIFY_ROUTING_ID_PARAM)
  })

  it("Filters out messages inside cooldown", async () => {
    const fresh = constructPSUDataItem({RequestID: "fresh", TaskID: "t1"})
    const stale = constructPSUDataItem({RequestID: "stale", TaskID: "t2"})
    const msgFresh = constructPSUDataItemMessage({PSUDataItem: fresh})
    const msgStale = constructPSUDataItemMessage({PSUDataItem: stale})

    mockDrainQueue.mockImplementation(
      () => Promise.resolve({messages: [msgFresh, msgStale], isEmpty: true})
    )

    // returns true if the request ID is "fresh"
    mockCheckCooldownForUpdate.mockImplementation((logger, update) => {
      const u = update as { RequestID: string }
      return Promise.resolve(u.RequestID === "fresh")
    })

    // Notify request succeeds
    mockMakeBatchNotifyRequest.mockImplementationOnce(() => Promise.resolve(
      [
        {...msgFresh, success: true, notifyMessageId: "message"}
      ]
    ))

    mockRemoveSQSMessages.mockImplementation(() => Promise.resolve())
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    // we should only persist & delete the fresh one
    expect(mockAddPrescriptionMessagesToNotificationStateStore)
      .toHaveBeenCalledWith(expect.any(Object),
        [
          expect.objectContaining({
            ...msgFresh,
            success: true,
            notifyMessageId: expect.any(String)
          })
        ]
      )

    expect(mockRemoveSQSMessages)
      .toHaveBeenCalledWith(expect.any(Object),
        [
          expect.objectContaining({
            ...msgFresh,
            success: true,
            notifyMessageId: expect.any(String)
          })
        ]
      )

    // and log how many were suppressed
    expect(mockInfo).toHaveBeenCalledWith(
      "Suppressed 1 messages due to cooldown",
      {suppressedCount: 1, totalFetched: 2}
    )
  })

  it("Logs a message when all messages are inside cooldown", async () => {
    const stale = constructPSUDataItem({RequestID: "stale", TaskID: "t1"})
    const msgStale = constructPSUDataItemMessage({PSUDataItem: stale})

    mockDrainQueue.mockImplementation(
      () => Promise.resolve({messages: [msgStale], isEmpty: true})
    )

    // returns true if the request ID is "fresh"
    mockCheckCooldownForUpdate.mockImplementation((logger, update) => {
      const u = update as { RequestID: string }
      return Promise.resolve(u.RequestID === "fresh")
    })

    mockRemoveSQSMessages.mockImplementation(() => Promise.resolve())
    mockAddPrescriptionMessagesToNotificationStateStore.mockImplementation(() => Promise.resolve())
    mockMakeBatchNotifyRequest.mockImplementation(() => Promise.resolve([])) // This function never returns undefined

    await lambdaHandler(mockEventBridgeEvent)

    expect(mockAddPrescriptionMessagesToNotificationStateStore).not.toHaveBeenCalled()
    expect(mockRemoveSQSMessages).toHaveBeenCalledWith(
      expect.any(Object),
      [expect.objectContaining(msgStale)]
    )

    // and log that everything was suppressed
    expect(mockInfo)
      .toHaveBeenCalledWith(
        "All messages suppressed by cooldown; nothing to notify",
        {suppressedCount: 1, totalFetched: 1}
      )
  })

  it("Stops draining after 14 minutes", async () => {
    const msg = constructPSUDataItemMessage()

    // call returns a non‐empty batch so the loop should continue
    mockDrainQueue.mockImplementation(() =>
      Promise.resolve({messages: [msg], isEmpty: false})
    )

    const nowSpy = jest.spyOn(Date, "now")
      .mockImplementationOnce(() => 0) // start time
      .mockImplementationOnce(() => (14 * 60 * 1000) + 1)

    // Happy‐path for everything else
    mockCheckCooldownForUpdate.mockReturnValueOnce(Promise.resolve(true))
    mockMakeBatchNotifyRequest.mockReturnValueOnce(Promise.resolve([
      {...msg, success: true, notifyMessageId: "m1"}
    ]))
    mockAddPrescriptionMessagesToNotificationStateStore.mockReturnValueOnce(() => Promise.resolve())
    mockRemoveSQSMessages.mockReturnValueOnce(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    // Calls a warning
    expect(mockWarn).toHaveBeenCalledTimes(1)

    // Since the timer advances before the promise resolves, this never gets called
    expect(mockDrainQueue).toHaveBeenCalledTimes(0)

    nowSpy.mockRestore()
  })
})
