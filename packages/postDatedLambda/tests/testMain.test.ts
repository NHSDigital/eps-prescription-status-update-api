import {
  vi,
  expect,
  describe,
  it,
  beforeAll,
  afterEach
} from "vitest"

const {
  mockReportQueueStatus,
  mockProcessPostDatedQueue
} = vi.hoisted(() => ({
  mockReportQueueStatus: vi.fn(),
  mockProcessPostDatedQueue: vi.fn()
}))

vi.mock(
  "../src/sqs",
  async () => ({
    __esModule: true,
    reportQueueStatus: mockReportQueueStatus
  })
)

vi.mock(
  "../src/orchestration",
  async () => ({
    __esModule: true,
    processPostDatedQueue: mockProcessPostDatedQueue
  })
)

let lambdaHandler: typeof import("../src/main").lambdaHandler
beforeAll(async () => {
  ({lambdaHandler} = await import("../src/main"))
})

import {mockEventBridgeEvent} from "@psu-common/testing"

const ORIGINAL_ENV = {...process.env}

describe("Unit test for post-dated lambda handler", () => {
  afterEach(() => {
    process.env = {...ORIGINAL_ENV}

    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("should run the lambda handler successfully", async () => {
    mockReportQueueStatus.mockImplementation(() => Promise.resolve())
    mockProcessPostDatedQueue.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.toBeUndefined()

    expect(mockReportQueueStatus).toHaveBeenCalledTimes(1)
    expect(mockProcessPostDatedQueue).toHaveBeenCalledTimes(1)
  })

  it("Should handle errors from reportQueueStatus", async () => {
    mockReportQueueStatus.mockImplementation(() => {
      throw new Error("Dynamo error")
    })
    mockProcessPostDatedQueue.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Dynamo error")

    expect(mockReportQueueStatus).toHaveBeenCalledTimes(1)
    expect(mockProcessPostDatedQueue).not.toHaveBeenCalled()
  })

  it("Should handle errors from processPostDatedQueue", async () => {
    mockReportQueueStatus.mockImplementation(() => Promise.resolve())
    mockProcessPostDatedQueue.mockImplementation(() => {
      throw new Error("Processing error")
    })

    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Processing error")

    expect(mockReportQueueStatus).toHaveBeenCalledTimes(1)
    expect(mockProcessPostDatedQueue).toHaveBeenCalledTimes(1)
  })

})
