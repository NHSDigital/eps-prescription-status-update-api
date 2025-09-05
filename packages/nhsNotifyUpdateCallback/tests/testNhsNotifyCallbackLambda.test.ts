import {
  jest,
  describe,
  it,
  beforeAll
} from "@jest/globals"

import {generateMockEvent} from "./utilities"
import {CallbackType, ChannelStatusResponse} from "../src/types"

const mockCheckSignature = jest.fn()
const mockResponse = jest.fn()
const mockUpdateNotificationsTable = jest.fn()
const mockExtractStatusesAndDescriptions = jest.fn()
jest.unstable_mockModule(
  "../src/helpers",
  async () => ({
    __esModule: true,
    checkSignature: mockCheckSignature,
    response: mockResponse,
    updateNotificationsTable: mockUpdateNotificationsTable,
    extractStatusesAndDescriptions: mockExtractStatusesAndDescriptions
  })
)

let handler: typeof import("../src/lambdaHandler").handler

beforeAll(async () => {
  ({handler} = await import("../src/lambdaHandler"))
})

const ORIGINAL_ENV = {...process.env}

describe("NHS Notify update callback lambda handler", () => {
  beforeEach(() => {
    process.env = {...ORIGINAL_ENV}
    jest.clearAllMocks()
    jest.restoreAllMocks()
    jest.resetAllMocks()

    // Copies the real implementation
    mockResponse.mockImplementation((...args: Array<unknown>): {statusCode: number; body: string} => {
      const [statusCode, body = {}] = args as [number, unknown]
      return {
        statusCode,
        body: JSON.stringify(body)
      }
    })
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
    const payload = {
      status: "foo",
      data: [
        {
          attributes: {
            messageStatus: "messageStatus",
            messageReference: "messageReference",
            messageId: "messageId",
            timestamp: "timestamp"
          }
        }
      ]
    }
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

  it("Returns 400 but still hits the database if CallbackType is not recognised", async () => {
    const payload = {
      data: [
        {
          type: "globglogabgalab",
          links: {
            message: "https://example.org"
          },
          meta: {
            idempotencyKey: "deadbeef"
          },
          attributes: {
            messageStatus: "messageStatus",
            messageReference: "messageReference",
            messageId: "messageId",
            timestamp: "timestamp"
          }
        }
      ]
    }
    const event = generateMockEvent(payload)
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = JSON.stringify(payload)
    mockUpdateNotificationsTable.mockImplementation(() => Promise.resolve())

    const result = await handler(event, {})

    expect(mockCheckSignature).toHaveBeenCalledWith(expect.any(Object), event)
    expect(mockUpdateNotificationsTable).toHaveBeenCalledWith(expect.any(Object), payload)

    expect(result.statusCode).toBe(400)

    const body = typeof result.body === "string" ? JSON.parse(result.body) : result.body
    expect(body).toEqual({message: expect.any(String)})
  })

  it("returns 202 and 'OK' when MessageStatus is valid and succeeds", async () => {
    const payload = {
      data: [
        {
          type: "MessageStatus",
          links: {
            message: "https://example.org"
          },
          meta: {
            idempotencyKey: "deadbeef"
          },
          attributes: {
            messageStatus: "messageStatus",
            messageReference: "messageReference",
            messageId: "31JwuwbJOv68kgsHuxKeq4oqpDe",
            timestamp: "2025-08-15T11:02:19+0000"
          }
        }
      ]
    }
    const event = generateMockEvent(payload)
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = JSON.stringify(payload)
    mockUpdateNotificationsTable.mockImplementation(() => Promise.resolve())

    const result = await handler(event, {})

    expect(mockCheckSignature).toHaveBeenCalledWith(expect.any(Object), event)
    expect(mockUpdateNotificationsTable).toHaveBeenCalledWith(expect.any(Object), payload)
    expect(result.statusCode).toEqual(202)
  })

  it("returns 202 and 'OK' when ChannelStatus is valid and succeeds", async () => {
    const payload: ChannelStatusResponse = {
      data: [
        {
          type: CallbackType.channel,
          links: {
            message: "https://example.org"
          },
          meta: {
            idempotencyKey: "deadbeef"
          },
          attributes: {
            channelStatus: "delivered",
            channel: "nhsapp",
            retryCount: 0,
            supplierStatus: "read",
            messageReference: "messageReference",
            messageId: "31Jwv2SS0Zq3vVDOrCtDHdxvJXW",
            timestamp: "2025-08-15T11:02:19+0000"
          }
        }
      ]
    }
    const event = generateMockEvent(payload)
    event.headers["x-request-id"] = "abc"
    mockCheckSignature.mockImplementation(() => undefined)
    event.body = JSON.stringify(payload)
    mockUpdateNotificationsTable.mockImplementation(() => Promise.resolve())

    const result = await handler(event, {})

    expect(mockCheckSignature).toHaveBeenCalledWith(expect.any(Object), event)
    expect(mockUpdateNotificationsTable).toHaveBeenCalledWith(expect.any(Object), payload)
    expect(result.statusCode).toEqual(202)
  })
})
