import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

let lambdaHandler: typeof import("../src/main").lambdaHandler
beforeAll(async () => {
  ({lambdaHandler} = await import("../src/main"))
})

import {mockEventBridgeEvent} from "@psu-common/testing"

const ORIGINAL_ENV = {...process.env}

describe("Unit test for NHS Notify lambda handler", () => {
  afterEach(() => {
    process.env = {...ORIGINAL_ENV}

    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("should run the lambda handler successfully", async () => {
    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.toBeUndefined()
  })

})
