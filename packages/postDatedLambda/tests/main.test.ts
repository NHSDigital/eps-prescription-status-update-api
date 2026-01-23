import {
  describe,
  it,
  beforeAll,
  afterEach,
  jest
} from "@jest/globals"
import {mockEventBridgeEvent} from "@psu-common/testing"

let lambdaHandler: typeof import("../src/main").lambdaHandler

const ORIGINAL_ENV = {...process.env}

describe("post-dated lambda placeholder", () => {
  beforeAll(async () => {
    ({lambdaHandler} = await import("../src/main"))
  })

  afterEach(() => {
    process.env = {...ORIGINAL_ENV}
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("logs a hello world message", async () => {
    await expect(lambdaHandler(mockEventBridgeEvent)).resolves.toBeUndefined()
  })
})
