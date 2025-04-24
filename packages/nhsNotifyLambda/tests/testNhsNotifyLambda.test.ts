import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

const mockDrainQueue = jest.fn()
jest.unstable_mockModule(
  "../src/utils",
  async () => ({
    __esModule: true,
    drainQueue: mockDrainQueue
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

  it("When drainQueue returns only valid JSON messages, all are processed", async () => {
    const validItem = {
      prescriptionId: "abc123",
      TaskID: "task-1",
      "x-request-id": "req-1"
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
            xRequestId: "req-1",
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
      "x-request-id": "req-2"
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
            xRequestId: "req-2",
            TaskId: "task-2",
            Message: "Notification Required"
          }
        ]
      }
    )
  })
})
