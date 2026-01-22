import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

const mockReportQueueStatus = jest.fn()
jest.unstable_mockModule(
  "../src/sqs",
  async () => ({
    __esModule: true,
    reportQueueStatus: mockReportQueueStatus
  })
)

const mockProcessPostDatedQueue = jest.fn()
jest.unstable_mockModule(
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

    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("should run the lambda handler successfully", async () => {
    mockReportQueueStatus.mockImplementation(() => Promise.resolve())
    mockProcessPostDatedQueue.mockImplementation(() => Promise.resolve())

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.toBeUndefined()

    expect(mockReportQueueStatus).toHaveBeenCalledTimes(1)
    expect(mockProcessPostDatedQueue).toHaveBeenCalledTimes(1)
  })

})
