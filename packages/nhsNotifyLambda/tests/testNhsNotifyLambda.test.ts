import {jest, describe, it} from "@jest/globals"

const mockDrainQueue = jest.fn()
jest.unstable_mockModule(
  "../src/utils",
  async () => {
    return {
      __esmodule: true,
      drainQueue: mockDrainQueue
    }
  }
)

let lambdaHandler: typeof import("../src/nhsNotifyLambda").lambdaHandler
beforeAll(async () => {
  ({lambdaHandler} = await import("../src/nhsNotifyLambda"))
})

import {mockEventBridgeEvent} from "@PrescriptionStatusUpdate_common/testing"

const ORIGINAL_ENV = {...process.env}

describe("Unit test for NHS Notify lambda handler", function () {

  afterEach(() => {
    process.env = {...ORIGINAL_ENV}
  })

  it("When drainQueue throws an error, the handler throws an error", async () => {
    mockDrainQueue.mockImplementation(() => Promise.reject(new Error("Failed")))
    await expect(lambdaHandler(mockEventBridgeEvent)).rejects.toThrow("Failed")
  })

  it("When drainQueue returns no messages, the request succeeds", async () => {
    mockDrainQueue.mockImplementation(() => Promise.resolve([]))

    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.not.toThrow()
  })
})
