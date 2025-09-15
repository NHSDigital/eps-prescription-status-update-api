import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"
import nock from "nock"
import axiosRetry from "axios-retry"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"
import {GetQueueAttributesCommand, DeleteMessageBatchCommand, Message} from "@aws-sdk/client-sqs"

import {constructMessage, constructPSUDataItemMessage, mockSQSClient} from "./testHelpers"

const {mockSend: sqsMockSend} = mockSQSClient()

const TEST_URL = "https://example.com"
const mockGetParametersByName = jest.fn(async () => Promise.resolve(
  {
    [process.env.NOTIFY_API_BASE_URL_PARAM!]: TEST_URL,
    [process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!]: "true"
  }
))

jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/ssm",
  async () => ({
    __esModule: true,
    SSMProvider: jest.fn().mockImplementation(() => ({
      getParametersByName: mockGetParametersByName
    }))
  })
)

const mockGetSecret = jest.fn().mockImplementation(() => "secret_value")
jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/secrets",
  async () => ({
    __esModule: true,
    getSecret: mockGetSecret
  })
)

const mockTokenExchange = jest.fn().mockImplementation(() => Promise.resolve("bearer token"))
jest.unstable_mockModule(
  "../src/utils/auth",
  async () => ({
    __esModule: true,
    tokenExchange: mockTokenExchange
  })
)

let mockNotifyRequestMaxItems = 5
let mockNotifyRequestMaxBytes = 5 * 1024 * 1024 // 5 MB
jest.unstable_mockModule(
  "../src/utils/constants",
  async () => ({
    __esModule: true,
    NOTIFY_REQUEST_MAX_ITEMS: mockNotifyRequestMaxItems,
    NOTIFY_REQUEST_MAX_BYTES: mockNotifyRequestMaxBytes,
    DUMMY_NOTIFY_DELAY_MS: 100,
    TTL_DELTA: 60 * 60 * 24 * 14 // Keep records for 2 weeks
  })
)

const {
  addPrescriptionMessagesToNotificationStateStore,
  removeSQSMessages,
  checkCooldownForUpdate,
  reportQueueStatus,
  drainQueue,
  handleNotifyRequests
} = await import("../src/utils")

const ORIGINAL_ENV = {...process.env}

describe("NHS notify lambda helper functions", () => {

  describe("drainQueue", () => {
    let logger: Logger
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "test-service"})
      errorSpy = jest.spyOn(logger, "error")
      infoSpy = jest.spyOn(logger, "info")
    })

    it("Does not throw an error when the SQS fetch succeeds", async () => {
      const payload = {Messages: Array.from({length: 10}, () => (constructMessage()))}

      sqsMockSend.mockImplementationOnce(() => Promise.resolve(payload))

      const {messages, isEmpty} = await drainQueue(logger, 10)
      expect(isEmpty).toBeFalsy()
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
      expect(messages).toHaveLength(10)
      expect(infoSpy).toHaveBeenCalledWith(
        "Received some messages from the queue. Parsing them...",
        expect.objectContaining({pollingIteration: 1, MessageIDs: expect.any(Array)})
      )
    })

    it("Batches multiple fetches until maxTotal is reached and stops on empty response", async () => {
      // First fetch returns 5, second fetch returns 5, third fetch empty
      const first = {Messages: Array.from({length: 5}, () => constructMessage())}
      const second = {Messages: Array.from({length: 5}, () => constructMessage())}
      const empty = {Messages: []}

      sqsMockSend
        .mockImplementationOnce(() => Promise.resolve(first))
        .mockImplementationOnce(() => Promise.resolve(second))
        .mockImplementationOnce(() => Promise.resolve(empty))

      const {messages, isEmpty} = await drainQueue(logger, 15)
      expect(isEmpty).toBeTruthy()
      expect(sqsMockSend).toHaveBeenCalledTimes(3)
      expect(messages).toHaveLength(10)
      expect(infoSpy).toHaveBeenCalledTimes(4)
    })

    it("Does not return more than the maximum number of messages, even if more are available", async () => {
      const mockQueue = () => Promise.resolve({Messages: Array.from({length: 10}, () => constructMessage())})
      sqsMockSend.mockImplementation(mockQueue)

      const {messages, isEmpty} = await drainQueue(logger, 20)
      expect(isEmpty).toBeFalsy()

      expect(sqsMockSend).toHaveBeenCalledTimes(2)
      expect(messages).toHaveLength(20)
      expect(infoSpy).toHaveBeenCalledTimes(3)
    })

    it("Stops polling the queue if not enough messages are returned from the queue", async () => {
      const first = {Messages: Array.from({length: 10}, () => constructMessage())}
      const second = {Messages: Array.from({length: 4}, () => constructMessage())}

      sqsMockSend
        .mockImplementationOnce(() => Promise.resolve(first))
        .mockImplementationOnce(() => Promise.resolve(second))

      const {messages, isEmpty} = await drainQueue(logger, 20)
      expect(isEmpty).toBeTruthy()
      expect(sqsMockSend).toHaveBeenCalledTimes(2)
      expect(messages).toHaveLength(14)
    })

    it("returns empty array if queue is empty on first fetch", async () => {
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Messages: []}))

      const {messages, isEmpty} = await drainQueue(logger, 5)
      expect(isEmpty).toBeTruthy()
      expect(messages).toEqual([])
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
    })

    it("Throws an error if the SQS fetch fails", async () => {
      sqsMockSend.mockImplementation(() => Promise.reject(new Error("Fetch failed")))
      await expect(drainQueue(logger, 10)).rejects.toThrow("Fetch failed")
    })

    it("Throws no error if a message has no Body", async () => {
      const badMsg = constructMessage({Body: undefined})
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Messages: [badMsg]}))

      await drainQueue(logger, 1)
      expect(errorSpy).toHaveBeenCalledWith(
        "Received an invalid SQS message (missing Body) - omitting from processing.",
        {offendingMessage: badMsg}
      )
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {drainQueue: dq} = await import("../src/utils")
      await expect(dq(logger)).rejects.toThrow(
        "NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set"
      )
      expect(errorSpy).toHaveBeenCalledWith("Notifications SQS URL not configured")
    })
  })

  describe("removeSQSMessages", () => {
    let logger: Logger
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "test-service"})
      errorSpy = jest.spyOn(logger, "error")
      infoSpy = jest.spyOn(logger, "info")
    })

    it("deletes messages in a single batch successfully", async () => {
      const messages: Array<Message> = [
        constructMessage({MessageId: "msg1", ReceiptHandle: "rh1"}),
        constructMessage({MessageId: "msg2", ReceiptHandle: "rh2"})
      ]

      // successful delete (no .Failed)
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({}))

      await expect(removeSQSMessages(logger, messages))
        .resolves
        .toBeUndefined()

      expect(sqsMockSend).toHaveBeenCalledTimes(1)

      const cmd = sqsMockSend.mock.calls[0][0]

      expect(cmd).toBeInstanceOf(DeleteMessageBatchCommand)
      expect((cmd as DeleteMessageBatchCommand).input).toEqual({
        QueueUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL,
        Entries: [
          {Id: "msg1", ReceiptHandle: "rh1"},
          {Id: "msg2", ReceiptHandle: "rh2"}
        ]
      })
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it("splits into batches of 10 when over the SQS limit", async () => {
      const messages: Array<Message> = Array.from({length: 12}, (_, i) =>
        constructMessage({MessageId: `msg${i}`, ReceiptHandle: `rh${i}`})
      )
      // succeed both batches
      sqsMockSend.mockImplementation(() => Promise.resolve({}))

      await removeSQSMessages(logger, messages)
      expect(sqsMockSend).toHaveBeenCalledTimes(2)

      // first batch of 10
      const firstCmd = sqsMockSend.mock.calls[0][0] as DeleteMessageBatchCommand
      expect(firstCmd.input.Entries).toHaveLength(10)
      // second batch of 2
      const secondCmd = sqsMockSend.mock.calls[1][0] as DeleteMessageBatchCommand
      expect(secondCmd.input.Entries).toHaveLength(2)

      expect(infoSpy).toHaveBeenCalledWith(
        "Deleting batch 1/2",
        expect.objectContaining({batchSize: 10, messageIds: expect.any(Array)})
      )
      expect(infoSpy).toHaveBeenCalledWith(
        "Deleting batch 2/2",
        expect.objectContaining({batchSize: 2, messageIds: expect.any(Array)})
      )
    })

    it("logs and throws if some deletions fail", async () => {
      const messages: Array<Message> = [constructMessage({MessageId: "msg1", ReceiptHandle: "rh1"})]
      const failedEntries = [
        {Id: "msg1", SenderFault: true, Code: "Error", Message: "fail"}
      ]

      // partial failure
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Failed: failedEntries}))

      await removeSQSMessages(logger, messages)

      expect(errorSpy).toHaveBeenCalledWith(
        "Some messages failed to delete in this batch",
        {failed: failedEntries}
      )
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {removeSQSMessages: clearFunc} = await import("../src/utils")

      await expect(clearFunc(logger, [])).rejects.toThrow("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
      expect(errorSpy).toHaveBeenCalledWith("Notifications SQS URL not configured")
    })
  })

  describe("addPrescriptionMessagesToNotificationStateStore", () => {
    let logger: Logger
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let sendSpy: ReturnType<typeof jest.spyOn>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}

      logger = new Logger({serviceName: "test-service"})
      infoSpy = jest.spyOn(logger, "info")
      errorSpy = jest.spyOn(logger, "error")
      sendSpy = jest.spyOn(DynamoDBDocumentClient.prototype, "send")
    })

    it("throws and logs error if TABLE_NAME is not set", async () => {
      delete process.env.TABLE_NAME
      const {addPrescriptionMessagesToNotificationStateStore: addFn} = await import("../src/utils")

      await expect(
        addFn(logger, [constructPSUDataItemMessage()])
      ).rejects.toThrow("TABLE_NAME not set")

      expect(errorSpy).toHaveBeenCalledWith(
        "DynamoDB table not configured"
      )
      // ensure we never attempted to send
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it("throws and logs error when a DynamoDB write fails", async () => {
      const item = constructPSUDataItemMessage()
      const awsErr = new Error("AWS error")
      sendSpy.mockImplementationOnce(() => Promise.reject(awsErr))

      await expect(
        addPrescriptionMessagesToNotificationStateStore(logger, [item])
      ).rejects.toThrow("AWS error")

      expect(sendSpy).toHaveBeenCalledTimes(1)
      // error log includes the item that failed, and the error
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to write to DynamoDB",
        {
          error: awsErr,
          item: expect.any(Object)
        }
      )
    })

    it("puts data in DynamoDB and logs correctly when configured", async () => {
      const item = constructPSUDataItemMessage()
      sendSpy.mockImplementationOnce(() => Promise.resolve({}))

      await addPrescriptionMessagesToNotificationStateStore(logger, [item])

      expect(infoSpy).toHaveBeenCalledWith(
        "Attempting to push data to DynamoDB",
        {count: 1}
      )

      // send was called exactly once with a PutCommand
      expect(sendSpy).toHaveBeenCalledTimes(1)
      const cmd = sendSpy.mock.calls[0][0] as PutCommand
      expect(cmd).toBeInstanceOf(PutCommand)

      // No errors
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it("does nothing when passed an empty array", async () => {
      await addPrescriptionMessagesToNotificationStateStore(logger, [])
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("No data to push into DynamoDB.")
      expect(sendSpy).not.toHaveBeenCalled()
    })
  })

  describe("checkCooldownForUpdate", () => {
    let logger: Logger
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let sendSpy: ReturnType<typeof jest.spyOn>

    beforeEach(async () => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}

      logger = new Logger({serviceName: "test-service"})
      infoSpy = jest.spyOn(logger, "info")
      errorSpy = jest.spyOn(logger, "error")
      sendSpy = jest.spyOn(DynamoDBDocumentClient.prototype, "send")
    })

    afterAll(() => {
      process.env = {...ORIGINAL_ENV}
    })

    it("throws if TABLE_NAME is not set", async () => {
      delete process.env.TABLE_NAME
      const {checkCooldownForUpdate: fn} = await import("../src/utils")
      const update = constructPSUDataItemMessage().PSUDataItem

      await expect(fn(logger, update)).rejects.toThrow("TABLE_NAME not set")
      expect(errorSpy).toHaveBeenCalledWith("DynamoDB table not configured")
    })

    it("returns true if no previous record exists", async () => {
      // send resolves with no item
      sendSpy.mockImplementationOnce(() => Promise.resolve({}))

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(sendSpy).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
    })

    it("returns true when last notification is older than default cooldown", async () => {
      const pastTs = new Date(Date.now() - (1000 * 901)).toISOString() // 901s ago
      sendSpy.mockImplementationOnce(() => {
        return {
          Items: [
            {LastNotificationRequestTimestamp: {S: new Date(Date.now() - 1000 * 5000).toISOString()}}, // very old
            {LastNotificationRequestTimestamp: {S: pastTs}}
          ]
        }
      })

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(result).toBe(true)
    })

    it("returns false when ANY item is within the cooldown window", async () => {
      const recentTs = new Date(Date.now() - 1000 * 300).toISOString() // 300s ago
      const oldTs = new Date(Date.now() - 1000 * 10_000).toISOString() // old

      sendSpy.mockImplementationOnce(() => {
        return {
          Items: [
            {LastNotificationRequestTimestamp: {S: oldTs}},
            {LastNotificationRequestTimestamp: {S: recentTs}} // within cooldown → should suppress
          ]
        }
      })

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(result).toBe(false)
    })

    it("honours a custom cooldownPeriod", async () => {
      // custom cooldown = 60 seconds, but timestamp is only 30s ago
      const recentTs = new Date(Date.now() - 30000).toISOString()
      sendSpy.mockImplementationOnce(() => {
        return {
          Items: [{LastNotificationRequestTimestamp: {S: recentTs}}]
        }
      })

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 60)

      expect(result).toBe(false)
    })

    it("returns false when items exist but none have valid timestamps", async () => {
      sendSpy.mockImplementationOnce(() => {
        return {
          Items: [
            {}, // no timestamp attribute
            {SomeOtherField: {S: "foo"}}
          ]
        }
      })

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(result).toBe(false)
    })

    it("propagates and logs errors from DynamoDB", async () => {
      const awsErr = new Error("DDB failure")
      sendSpy.mockImplementationOnce(() => Promise.reject(awsErr))

      const update = constructPSUDataItemMessage().PSUDataItem
      await expect(checkCooldownForUpdate(logger, update)).rejects.toThrow("DDB failure")
    })

    it("does nothing when passed an empty array", async () => {
      await addPrescriptionMessagesToNotificationStateStore(logger, [])
      expect(infoSpy).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("No data to push into DynamoDB.")
      expect(sendSpy).not.toHaveBeenCalled()
    })
  })

  describe("handleNotifyRequests", () => {
    let logger: Logger
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      process.env = {...ORIGINAL_ENV}
      jest.resetModules()
      jest.clearAllMocks()
      nock.cleanAll()

      logger = new Logger({serviceName: "test-service"})
      errorSpy = jest.spyOn(logger, "error")
      infoSpy = jest.spyOn(logger, "info")
    })

    afterEach(() => {
      process.env = {...ORIGINAL_ENV}

      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    })

    it("sends a batch and maps successful messages correctly", async () => {
      const data = [
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r1",
            PatientNHSNumber: "n1",
            PharmacyODSCode: "o1",
            TaskID: "t1",
            Status: "s1"
          }
        }),
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r2",
            PatientNHSNumber: "n2",
            PharmacyODSCode: "o2",
            TaskID: "t2",
            Status: "s2"
          }
        })
      ]
      const returnedMessages = [
        {
          messageReference: data[0].messageReference,
          id: "msg-id-1"
        }
      ]

      // nock the POST
      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .reply(201, {
          data: {attributes: {messages: returnedMessages}}
        })

      const result = await handleNotifyRequests(
        logger,
        "plan-123",
        data
      )

      // Should return one success and one failure
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        PSUDataItem: data[0].PSUDataItem,
        messageStatus: "requested",
        notifyMessageId: "msg-id-1",
        messageBatchReference: expect.any(String),
        messageReference: expect.any(String)
      })
      expect(result[1]).toMatchObject({
        PSUDataItem: data[1].PSUDataItem,
        messageStatus: "notify request failed",
        notifyMessageId: undefined,
        messageBatchReference: expect.any(String),
        messageReference: expect.any(String)
      })
    })

    it("handles non-ok response by marking all as failed", async () => {
      const data = [
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "rA",
            PatientNHSNumber: "nx",
            PharmacyODSCode: "ox",
            TaskID: "tx",
            Status: "st"
          }
        })
      ]

      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .reply(500, "Internal Server Error")

      jest.useFakeTimers()
      // force retryDelay to 0 so retries happen immediately in tests
      jest.spyOn(axiosRetry, "exponentialDelay").mockImplementation(() => 0)

      const resultPromise = handleNotifyRequests(
        logger,
        "plan-xyz",
        data
      )

      // flush retries immediately
      await jest.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toMatchObject([
        {
          PSUDataItem: data[0].PSUDataItem,
          messageStatus: "notify request failed",
          notifyMessageId: undefined,
          messageBatchReference: expect.any(String),
          messageReference: expect.any(String)
        }
      ])
      expect(errorSpy).toHaveBeenCalledWith(
        "Notify batch request failed",
        expect.anything()
      )
    })

    it("handles fetch exceptions by marking all as failed and logging error", async () => {
      const data = [
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "rX",
            PatientNHSNumber: "ny",
            PharmacyODSCode: "oy",
            TaskID: "ty",
            Status: "st"
          }
        }),
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "rY",
            PatientNHSNumber: "nz",
            PharmacyODSCode: "oz",
            TaskID: "tz",
            Status: "sx"
          }
        })
      ]

      // Simulate network failure
      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .replyWithError(new Error("Network failure"))

      const result = await handleNotifyRequests(
        logger,
        "plan-error",
        data
      )

      expect(result).toHaveLength(2)
      result.forEach((r) =>
        expect(r).toEqual(
          expect.objectContaining({
            messageStatus: "notify request failed",
            notifyMessageId: undefined
          })
        )
      )
      expect(errorSpy).toHaveBeenCalledWith(
        "Notify batch request failed",
        expect.anything()
      )
    })

    it("splits very large payloads into two recursive batch requests", async () => {
      const data = Array.from({length: 7}, (_, i) =>
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: `r${i}`,
            PatientNHSNumber: `n${i}`,
            PharmacyODSCode: `o${i}`,
            TaskID: `t${i}`,
            Status: `s${i}`
          }
        })
      )

      // every sub-batch returns an empty messages array
      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .times(2)
        .reply(201, {
          data: {attributes: {messages: []}}
        })

      const result = await handleNotifyRequests(
        logger,
        "plan-large",
        data
      )

      expect(result).toHaveLength(7) // Returns all items

      // Don't repeat the token exchange for each sub-batch
      expect(mockTokenExchange).toHaveBeenCalledTimes(1)

      expect(errorSpy).not.toHaveBeenCalled()

      // Two calls
      expect(infoSpy).toHaveBeenCalledWith(
        "Making a request for notifications to NHS notify",
        {count: 3, routingPlanId: "plan-large"}
      )
      expect(infoSpy).toHaveBeenCalledWith(
        "Making a request for notifications to NHS notify",
        {count: 4, routingPlanId: "plan-large"}
      )
    })

    it("retries after 425/429 with Retry-After header", async () => {
      jest.useFakeTimers({advanceTimers: true})

      const data = [
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r1",
            PatientNHSNumber: "n1",
            PharmacyODSCode: "o1",
            TaskID: "t1",
            Status: "s1"
          }
        }),
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r2",
            PatientNHSNumber: "n2",
            PharmacyODSCode: "o2",
            TaskID: "t2",
            Status: "s2"
          }
        })
      ]
      const returnedMessages = [
        {
          messageReference: data[0].Attributes?.MessageDeduplicationId,
          id: "msg-id-1"
        }
      ]

      // First reply 429 with header
      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .reply(429, "", {"Retry-After": "2"})
        // Then the successful one
        .post("/comms/v1/message-batches")
        .reply(201, {
          data: {attributes: {messages: returnedMessages}}
        })

      const resultPromise = handleNotifyRequests(
        logger,
        "plan-retry",
        data
      )
      const result = await resultPromise
      jest.runAllTicks()
      jest.useRealTimers()

      expect(result).toHaveLength(2)
    })

    it("uses a dummy call when the MAKE_REAL_NOTIFY_REQUESTS_PARAM is false", async () => {
      mockGetParametersByName.mockImplementation(async () => Promise.resolve(
        {
          [process.env.NOTIFY_API_BASE_URL_PARAM!]: TEST_URL,
          [process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!]: "false"
        }
      ))
      const {handleNotifyRequests: fn} = await import("../src/utils")

      const data = [
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r1",
            PatientNHSNumber: "n1",
            PharmacyODSCode: "o1",
            TaskID: "t1",
            Status: "s1"
          }
        }),
        constructPSUDataItemMessage({
          PSUDataItem: {
            RequestID: "r2",
            PatientNHSNumber: "n2",
            PharmacyODSCode: "o2",
            TaskID: "t2",
            Status: "s2"
          }
        })
      ]

      // nock the POST to fail, so if nock is called the test will fail
      nock(TEST_URL)
        .post("/comms/v1/message-batches")
        .reply(500)

      const result = await fn(
        logger,
        "plan-123",
        data
      )

      // Should return all successes
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        PSUDataItem: data[0].PSUDataItem,
        messageStatus: "silent running",
        notifyMessageId: expect.any(String), // it will be assigned a dummy ID
        messageBatchReference: expect.any(String),
        messageReference: expect.any(String)
      })
      expect(result[1]).toMatchObject({
        PSUDataItem: data[1].PSUDataItem,
        messageStatus: "silent running",
        notifyMessageId: expect.any(String),
        messageBatchReference: expect.any(String),
        messageReference: expect.any(String)
      })
    })
  })

  describe("reportQueueStatus", () => {
    let logger: Logger
    let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "test-service"})
      infoSpy = jest.spyOn(logger, "info")
      errorSpy = jest.spyOn(logger, "error")
    })

    it("logs current queue attributes when SQS returns attributes", async () => {
      const attrs = {
        ApproximateNumberOfMessages: "7",
        ApproximateNumberOfMessagesNotVisible: "4",
        ApproximateNumberOfMessagesDelayed: "1"
      }

      sqsMockSend.mockImplementationOnce((cmd) => {
        expect(cmd).toBeInstanceOf(GetQueueAttributesCommand)
        expect((cmd as GetQueueAttributesCommand).input).toEqual({
          QueueUrl: process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL,
          AttributeNames: [
            "ApproximateNumberOfMessages",
            "ApproximateNumberOfMessagesNotVisible",
            "ApproximateNumberOfMessagesDelayed"
          ]
        })
        return Promise.resolve({Attributes: attrs})
      })

      await reportQueueStatus(logger)

      expect(infoSpy).toHaveBeenCalledWith(
        "Current queue attributes (if a value failed to fetch, it will be reported as -1):",
        {
          ApproximateNumberOfMessages: 7,
          ApproximateNumberOfMessagesNotVisible: 4,
          ApproximateNumberOfMessagesDelayed: 1
        }
      )
    })

    it("throws if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {reportQueueStatus: rqs} = await import("../src/utils")

      await expect(rqs(logger)).rejects.toThrow(
        "NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set"
      )
      expect(errorSpy).toHaveBeenCalledWith("Notifications SQS URL not configured")
    })
  })

})
