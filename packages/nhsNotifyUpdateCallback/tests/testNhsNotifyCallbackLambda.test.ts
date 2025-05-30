import {
  jest,
  describe,
  it,
  beforeAll,
  afterEach
} from "@jest/globals"

import {generateMockEvent} from "./utilities"

const mockCheckSignature = jest.fn()
const mockResponse = jest.fn()
const mockUpdateNotificationsTable = jest.fn()
jest.unstable_mockModule(
  "../src/helpers",
  async () => ({
    __esModule: true,
    checkSignature: mockCheckSignature,
    response: mockResponse,
    updateNotificationsTable: mockUpdateNotificationsTable
  })
)

let handler: typeof import("../src/lambdaHandler").handler

beforeAll(async () => {
  ({handler} = await import("../src/lambdaHandler"))
})

const ORIGINAL_ENV = {...process.env}

describe("NHS Notify update callback lambda handler", () => {
  afterEach(() => {
    process.env = {...ORIGINAL_ENV}
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  it("returns 400 if no x-request-id header", async () => {
    const event = generateMockEvent({foo: "bar"})
    delete event.headers["x-request-id"]
    const bad = {statusCode: 400, body: JSON.stringify({message: "No x-request-id given"})}
    mockResponse.mockImplementation(() => bad)

    const result = await handler(event, {})

    expect(mockResponse).toHaveBeenCalledWith(400, {message: "No x-request-id given"})
    expect(result).toBe(bad)
    expect(mockCheckSignature).not.toHaveBeenCalled()
  })

  it("returns signature error if checkSignature returns an error response", async () => {
    const event = generateMockEvent({foo: "bar"})
    event.headers["x-request-id"] = "abc"
    const sigError = {statusCode: 401, body: "bad sig"}
    mockCheckSignature.mockImplementation(() => sigError)

    const result = await handler(event, {})

    expect(mockCheckSignature).toHaveBeenCalled()
    expect(result).toBe(sigError)
  })

  it("returns 400 if body is missing", async () => {
    const event = generateMockEvent({foo: "bar"})
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = null
    const bad = {statusCode: 400, body: JSON.stringify({message: "No request body given"})}
    mockResponse.mockImplementation(() => bad)

    const result = await handler(event, {})

    expect(mockResponse).toHaveBeenCalledWith(400, {message: "No request body given"})
    expect(result).toBe(bad)
  })

  it("returns 400 if body is invalid JSON", async () => {
    const event = generateMockEvent({foo: "bar"})
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = "not-json"
    const bad = {statusCode: 400, body: JSON.stringify({message: "Request body failed to parse"})}
    mockResponse.mockImplementation(() => bad)

    const result = await handler(event, {})

    expect(mockResponse).toHaveBeenCalledWith(400, {message: "Request body failed to parse"})
    expect(result).toBe(bad)
  })

  it("returns 500 if updateNotificationsTable throws", async () => {
    const payload = {status: "foo"}
    const event = generateMockEvent(payload)
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = JSON.stringify(payload)
    mockUpdateNotificationsTable.mockImplementation(() => Promise.reject(new Error("dynamo fail")))
    const errResp = {
      statusCode: 500,
      body: JSON.stringify({message: "Failed to update the notification state table"})
    }
    mockResponse.mockImplementation(() => errResp)

    const result = await handler(event, {})

    expect(mockResponse)
      .toHaveBeenCalledWith(500, {message: "Failed to update the notification state table"})
    expect(result).toBe(errResp)
  })

  it("returns 202 and 'OK' when everything succeeds", async () => {
    const payload = {status: "ok"}
    const event = generateMockEvent(payload)
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = JSON.stringify(payload)
    mockUpdateNotificationsTable.mockImplementation(() => Promise.resolve())

    const result = await handler(event, {})

    expect(mockCheckSignature).toHaveBeenCalledWith(expect.any(Object), event)
    expect(mockUpdateNotificationsTable).toHaveBeenCalledWith(expect.any(Object), payload)
    expect(result).toEqual({statusCode: 202, body: "OK"})
  })
})
