import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

const mockDrainQueue = jest.fn()
const mockClearCompletedSQSMessages = jest.fn()
jest.unstable_mockModule(
  "../src/utils",
  async () => ({
    __esModule: true,
    drainQueue: mockDrainQueue,
    clearCompletedSQSMessages: mockClearCompletedSQSMessages
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

    expect(mockInfo).toHaveBeenCalledWith("No messages to process")
  })

  it("Clears completed messages after successful processing", async () => {
    const item1 = {TaskID: "t1", RequestID: "r1"}
    const item2 = {TaskID: "t2", RequestID: "r2"}
    const msg1 = {Body: JSON.stringify(item1)}
    const msg2 = {Body: JSON.stringify(item2)}
    // drainQueue returns two messages
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve([msg1, msg2]))
    // deletion succeeds
    mockClearCompletedSQSMessages.mockImplementationOnce(() => Promise.resolve(undefined))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

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
      [msg1, msg2],
      expect.any(Object) // the logger instance
    )
  })

  it("Throws and logs if clearCompletedSQSMessages fails", async () => {
    const item = {TaskID: "tx", RequestID: "rx"}
    const msg = {Body: JSON.stringify(item)}
    mockDrainQueue.mockImplementationOnce(() => Promise.resolve([msg]))
    const deletionError = new Error("Delete failed")
    mockClearCompletedSQSMessages.mockImplementationOnce(() => Promise.reject(deletionError))

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Delete failed")

    expect(mockError).toHaveBeenCalledWith(
      "Error while deleting successfully processed messages from SQS",
      {error: deletionError}
    )
  })

  it("When drainQueue returns only valid JSON messages, all are processed", async () => {
    const validItem = {
      prescriptionId: "abc123",
      TaskID: "task-1",
      RequestID: "req-1"
    }
    mockDrainQueue.mockImplementation(() =>
      Promise.resolve([{Body: JSON.stringify(validItem)}])
    )

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

  it("Filters out invalid JSON and logs parse errors", async () => {
    const validItem = {
      foo: "bar",
      TaskID: "task-2",
      RequestID: "req-2"
    }
    const messages = [
      {Body: JSON.stringify(validItem)},
      {Body: "not-json"}
    ]
    mockDrainQueue.mockImplementation(() =>
      Promise.resolve(messages)
    )

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()

    // should have logged a parse‐error
    expect(mockError).toHaveBeenCalledWith(
      "Failed to parse message body",
      expect.objectContaining({
        body: "not-json",
        error: expect.any(Error)
      })
    )
    // only the one valid item should make it through
    expect(mockInfo).toHaveBeenCalledWith(
      "Fetched prescription notification messages",
      {
        count: 1,
        toNotify: [
          {
            RequestID: "req-2",
            TaskId: "task-2",
            Message: "Notification Required"
          }
        ]
      }
    )
  })
})
