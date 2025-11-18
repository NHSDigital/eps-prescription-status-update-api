import {
  jest,
  describe,
  it,
  beforeEach,
  afterEach,
  expect
} from "@jest/globals"
import {createHmac} from "crypto"

// Mock the getSecret call
const mockGetSecret = jest.fn((secretName: string) => {
  if (secretName === process.env.APP_ID_SECRET) {
    return Promise.resolve(process.env.APP_ID)
  }
  if (secretName === process.env.API_KEY_SECRET) {
    return Promise.resolve(process.env.API_KEY)
  }
  return Promise.reject(new Error("Unexpected secret"))
})
jest.unstable_mockModule("@aws-lambda-powertools/parameters/secrets", async () => ({
  __esModule: true,
  getSecret: mockGetSecret
}))

import {DynamoDBDocumentClient, QueryCommand, UpdateCommand} from "@aws-sdk/lib-dynamodb"
import type {UpdateCommandInput} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import {MessageStatusResponse} from "../src/types.js"
import {generateMockChannelStatusResponse, generateMockEvent, generateMockMessageStatusResponse} from "./utilities.js"

const {
  response,
  checkSignature,
  updateNotificationsTable
} = await import("../src/helpers.js")

const ORIGINAL_ENV = {...process.env}

describe("helpers.ts", () => {
  let sendSpy: jest.SpiedFunction<typeof DynamoDBDocumentClient.prototype.send>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Spy on all docClient.send calls
    sendSpy = jest.spyOn(DynamoDBDocumentClient.prototype, "send")

    // Freeze time so TTL is predictable
    jest.spyOn(Date, "now").mockReturnValue(100_000_000) // ms
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe("response()", () => {
    it("serialises status and body", () => {
      const r = response(418, {hello: "world"})
      expect(r).toEqual({
        statusCode: 418,
        body: JSON.stringify({hello: "world"})
      })
    })
  })

  describe("checkSignature()", () => {
    let logger: Logger
    let validHeaders: {"x-request-id": string; "apikey": string; "x-hmac-sha256-signature": string}
    beforeEach(() => {
      logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})
      validHeaders = {
        "x-request-id": "requestid",
        "apikey": "api-key",
        "x-hmac-sha256-signature": "deadbeef"
      }
    })

    it("401 when missing signature header", async () => {
      const ev = generateMockEvent("{}", {"apikey": "foobar", "x-request-id": "rid"})
      const resp = await checkSignature(logger, ev)
      expect(resp).toEqual({
        statusCode: 401,
        body: JSON.stringify({message: "No x-hmac-sha256-signature given"})
      })
    })

    it("403 when signature hex is malformed", async () => {
      const headers = {
        ...validHeaders,
        "x-hmac-sha256-signature": "not a hex string!@!#zzz"
      }
      const ev = generateMockEvent(JSON.stringify({message: "blah blah blah"}), headers)
      const resp = await checkSignature(logger, ev)

      expect(resp).toEqual({
        statusCode: 403,
        body: JSON.stringify({message: "Incorrect signature"})
      })
    })

    it("403 when signature does not match HMAC", async () => {
      const payload = "payload"
      const wrongSig = createHmac(
        "sha256",
        `${process.env.APP_ID}.${process.env.API_KEY}`
      )
        .update("different", "utf8")
        .digest("hex")

      const ev = generateMockEvent(payload, {
        ...validHeaders,
        "x-hmac-sha256-signature": wrongSig
      })
      const resp = await checkSignature(logger, ev)

      expect(resp).toEqual({
        statusCode: 403,
        body: JSON.stringify({message: "Incorrect signature"})
      })
    })

    it("returns undefined when signature is valid", async () => {
      const payload = "hi there"
      const secret = `${process.env.APP_ID}.${process.env.API_KEY}`
      const goodSig = createHmac("sha256", secret)
        .update(payload, "utf8")
        .digest("hex")

      const ev = generateMockEvent(payload, {
        ...validHeaders,
        "x-hmac-sha256-signature": goodSig
      })
      const resp = await checkSignature(logger, ev)
      expect(resp).toBeUndefined()
    })
  })

  describe("updateNotificationsTable()", () => {
    let logger: Logger
    beforeEach(() => {
      logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})
      jest.spyOn(logger, "error")
      jest.spyOn(logger, "warn")
      jest.spyOn(logger, "info")

      jest.resetModules()
      jest.clearAllMocks()
    })

    it("skips update when no matching record found", async () => {
      // QueryCommand returns no items
      sendSpy.mockImplementationOnce(() => Promise.resolve({Items: []}))

      const responsePayload: MessageStatusResponse = generateMockMessageStatusResponse()
      await updateNotificationsTable(logger, responsePayload)

      // Only QueryCommand should be called
      expect(sendSpy).toHaveBeenCalledTimes(1)
      // Warning logged
      expect(logger.warn).toHaveBeenCalledWith(
        "No matching record found for NotifyMessageID. Counting this as a successful update.",
        expect.objectContaining({messageId: responsePayload.data[0].attributes.messageId})
      )
    })

    it("skips update when callback is out of date", async () => {
      const msgTimestamp = "2025-01-01T00:00:00.000Z"
      const lastTimestamp = "2025-02-01T00:00:00.000Z" // newer than msg payload
      const msgPayload: MessageStatusResponse = generateMockMessageStatusResponse([
        {
          attributes: {
            timestamp: msgTimestamp
          }
        }])
      const mockItem = {
        NHSNumber: "NHS123",
        RequestId: "psu-request-id",
        NotifyMessageID: "msg-123",
        LastNotificationRequestTimestamp: lastTimestamp
      }
      sendSpy.mockImplementation((cmd) => {
        if (cmd instanceof QueryCommand) {
          return Promise.resolve({Items: [mockItem]})
        }
      })

      await updateNotificationsTable(logger, msgPayload)

      expect(logger.warn).toHaveBeenCalledWith(
        "Ignoring out-of-date callback",
        expect.objectContaining({messageId: msgPayload.data[0].attributes.messageId})
      )
      expect(logger.info).toHaveBeenCalledWith(
        "Number of up-to-date items remaining",
        expect.objectContaining({count: 0})
      )
      // Only QueryCommand should be called
      expect(sendSpy).toHaveBeenCalledTimes(1)
    })

    it("updates records when matching items found (Message update callback)", async () => {
      const overrideTimestamp = "2025-01-01T00:00:00.000Z"
      const mockResponse = generateMockMessageStatusResponse([
        {
          attributes: {
            messageId: "msg-123",
            messageStatus: "delivered",
            channels: [], // ensure channelStatus undefined
            timestamp: overrideTimestamp
          }
        }
      ])
      const mockItem = {
        NHSNumber: "NHS123",
        RequestId: "psu-request-id",
        NotifyMessageID: "msg-123",
        LastNotificationRequestTimestamp: "2024-01-01T00:00:00.000Z", // old timestamp
        ODSCode: "ODS123"
      }

      // First call: QueryCommand
      // Subsequent calls: UpdateCommand
      sendSpy.mockImplementation((cmd) => {
        if (cmd instanceof QueryCommand) {
          return Promise.resolve({Items: [mockItem]})
        }
        if (cmd instanceof UpdateCommand) {
          return Promise.resolve({})
        }
        return Promise.resolve({})
      })

      await updateNotificationsTable(logger, mockResponse)

      const [, [updateCmd]] = sendSpy.mock.calls
      const input = updateCmd.input as UpdateCommandInput

      // Note that Javascript guarantees the order of this to be preserved, so we're okay to check values like this.
      // We should have only three statuses
      expect(input.UpdateExpression).toContain("#n0 = :v0")
      expect(input.UpdateExpression).toContain("#n1 = :v1")
      expect(input.UpdateExpression).toContain("#n2 = :v2")
      expect(input.UpdateExpression).not.toContain("#n3 = :v3")

      // The names should match the values
      expect(input.ExpressionAttributeNames).toMatchObject({
        "#n0": "ExpiryTime",
        "#n1": "LastNotificationRequestTimestamp",
        "#n2": "MessageStatus"
      })

      // Should include MessageStatus and NOT Channel/Supplier when undefined
      expect(input.ExpressionAttributeValues).toMatchObject({
        ":v0": Math.floor(100_000_000 / 1000) + 60 * 60 * 24 * 7,
        ":v1": overrideTimestamp,
        ":v2": "delivered"
      })

      // Splunk reporting
      expect(logger.info).toHaveBeenCalledWith(
        "Updated notification state",
        expect.objectContaining({
          NotifyMessageID: mockItem.NotifyMessageID,
          nhsNumber: mockItem.NHSNumber,
          psuRequestId: mockItem.RequestId,
          pharmacyODSCode: mockItem.ODSCode,
          MessageStatus: "delivered",
          newTimestamp: overrideTimestamp,
          ExpiryTime: expect.any(Number)
        })
      )
    })

    it("updates only ChannelStatus and SupplierStatus for channel callback", async () => {
      const ts = "2025-02-02T12:34:56.000Z"
      const mockResponse = generateMockChannelStatusResponse([
        {
          attributes: {
            messageId: "msg-chan-1",
            channelStatus: "sending",
            supplierStatus: "accepted",
            timestamp: ts
          }
        }
      ])
      const mockItem = {
        NHSNumber: "NHS456",
        RequestId: "req-456",
        NotifyMessageID: "msg-chan-1",
        ODSCode: "ODS456"
      }

      // First call: QueryCommand
      // Subsequent calls: UpdateCommand
      sendSpy.mockImplementation((cmd) => {
        if (cmd instanceof QueryCommand) {
          return Promise.resolve({Items: [mockItem]})
        }
        if (cmd instanceof UpdateCommand) {
          return Promise.resolve({})
        }
        return Promise.resolve({})
      })

      await updateNotificationsTable(logger, mockResponse)

      const [, [updateCmd]] = sendSpy.mock.calls
      const input = updateCmd.input as UpdateCommandInput

      // Note that Javascript guarantees the order of this to be preserved, so we're okay to check values like this.
      // 5 defined key value pairs should be in there
      expect(input.UpdateExpression).toContain("#n0 = :v0")
      expect(input.UpdateExpression).toContain("#n1 = :v1")
      expect(input.UpdateExpression).toContain("#n2 = :v2")
      expect(input.UpdateExpression).toContain("#n3 = :v3")
      expect(input.UpdateExpression).toContain("#n4 = :v4")
      // And no more
      expect(input.UpdateExpression).not.toContain("#n5 = :v5")

      // The names should match the values
      expect(input.ExpressionAttributeNames).toMatchObject({
        "#n0": "ExpiryTime",
        "#n1": "LastNotificationRequestTimestamp",
        "#n2": "RetryCount",
        "#n3": "ChannelStatus",
        "#n4": "SupplierStatus"
      })

      expect(input.ExpressionAttributeValues).toMatchObject({
        ":v0": Math.floor(100_000_000 / 1000) + 60 * 60 * 24 * 7,
        ":v1": ts,
        ":v2": 0, // retryCount
        ":v3": "sending",
        ":v4": "accepted"
      })

      // For splunk reporting
      expect(logger.info).toHaveBeenCalledWith(
        "Updated notification state",
        expect.objectContaining({
          NotifyMessageID: mockItem.NotifyMessageID,
          nhsNumber: mockItem.NHSNumber,
          psuRequestId: mockItem.RequestId,
          pharmacyODSCode: mockItem.ODSCode,
          ChannelStatus: "sending",
          SupplierStatus: "accepted",
          newTimestamp: ts,
          ExpiryTime: expect.any(Number)
        })
      )
    })

    it("warns when not every received message update had a pre-existing record in the table", async () => {
      const mockResponse: MessageStatusResponse = generateMockMessageStatusResponse(
        [
          {attributes: {messageId: "msg-1"}},
          {attributes: {messageId: "msg-2"}}
        ],
        2
      )
      const mockItem = {
        NHSNumber: "NHS123",
        ODSCode: "ODS1",
        NotifyMessageID: "msg-1"
      }
      // QueryCommand returns only one item for both resources
      sendSpy.mockImplementation(() => Promise.resolve({Items: [mockItem]}))

      await updateNotificationsTable(logger, mockResponse)

      // Warning logged for uneven matching
      expect(logger.warn).toHaveBeenCalledWith(
        "Not every received message update had a pre-existing record in the table.",
        expect.objectContaining({
          requestItemsLength: mockResponse.data.length,
          tableQueryResultsLength: 1
        })
      )
    })

    it("logs error and continues when query fails", async () => {
      // Simulate query failure
      const awsError = new Error("Failed")
      sendSpy.mockImplementation(() => Promise.reject(awsError))

      const responsePayload: MessageStatusResponse = generateMockMessageStatusResponse()
      await expect(updateNotificationsTable(logger, responsePayload)).rejects.toThrow(awsError)

      expect(logger.error).toHaveBeenCalledWith(
        "Error querying by NotifyMessageID",
        expect.objectContaining({
          messageId: responsePayload.data[0].attributes.messageId,
          error: awsError
        })
      )
    })

    it("logs error and continues when update fails", async () => {
      const mockResponse: MessageStatusResponse = generateMockMessageStatusResponse()
      const mockItem = {
        NHSNumber: "NHS123",
        ODSCode: "ODS1",
        NotifyMessageID: mockResponse.data[0].attributes.messageId
      }
      // Query succeeds
      sendSpy.mockImplementationOnce(() => Promise.resolve({Items: [mockItem]}))
      // Update fails
      const awsError = new Error("Failed")
      sendSpy.mockImplementationOnce(() => Promise.reject(awsError))

      await updateNotificationsTable(logger, mockResponse)

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to update notification state",
        expect.objectContaining({
          NotifyMessageID: mockItem.NotifyMessageID,
          error: awsError
        })
      )
    })
  })

  describe("fetchSecrets()", () => {
    let logger: Logger
    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()
      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "nhsNotifyUpdateCallback"})
    })

    it("throws if APP_ID_SECRET env var is not set", async () => {
      delete process.env.APP_ID_SECRET

      const {fetchSecrets: fn} = await import("../src/helpers.js")
      await expect(fn(logger)).rejects.toThrow("APP_ID_SECRET environment variable is not set.")
    })

    it("throws if API_KEY_SECRET env var is not set", async () => {
      delete process.env.API_KEY_SECRET

      const {fetchSecrets: fn} = await import("../src/helpers.js")
      await expect(fn(logger)).rejects.toThrow("API_KEY_SECRET environment variable is not set.")
    })

    it("throws if getting either secret returns a falsy value", async () => {
      process.env.APP_ID = ""

      const {fetchSecrets: fn} = await import("../src/helpers.js")
      await expect(fn(logger)).rejects.toThrow(
        "Failed to get secret values from the AWS secret manager"
      )
    })

    it("fetches both secrets successfully", async () => {
      const {fetchSecrets: fn} = await import("../src/helpers.js")
      await expect(fn(logger)).resolves.toBeUndefined()

      expect(mockGetSecret).toHaveBeenCalledWith(process.env.APP_ID_SECRET!)
      expect(mockGetSecret).toHaveBeenCalledWith(process.env.API_KEY_SECRET!)
    })
  })
})
