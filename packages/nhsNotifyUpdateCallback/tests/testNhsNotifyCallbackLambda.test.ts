import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

import {generateMockEvent} from "./testHelpers"

const mockInfo = jest.fn()
const mockError = jest.fn()
jest.unstable_mockModule(
  "@aws-lambda-powertools/logger",
  async () => ({
    __esModule: true,
    Logger: jest.fn().mockImplementation(() => ({
      info: mockInfo,
      error: mockError,
      clearBuffer: jest.fn()
    }))
  })
)

let handler: typeof import("../src/lambdaHandler").handler

beforeAll(async () => {
  ({handler} = await import("../src/lambdaHandler"))
})

const ORIGINAL_ENV = {...process.env}

describe("Unit test for NHS Notify update callback lambda handler", () => {
  afterEach(() => {
    process.env = {...ORIGINAL_ENV}

    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("DUMMY TEST", async () => {
    const body = {}
    const event = generateMockEvent(body)
    await handler(event, {})
    console.error("DUMMY TEST! PASSING ANYWAY!!!")
  })
})
