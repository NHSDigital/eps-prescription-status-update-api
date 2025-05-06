import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient, GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb"
import {DeleteMessageBatchCommand, Message} from "@aws-sdk/client-sqs"

import {constructMessage, constructPSUDataItemMessage, mockSQSClient} from "./testHelpers"

const {mockSend: sqsMockSend} = mockSQSClient()

const {
  addPrescriptionMessagesToNotificationStateStore,
  clearCompletedSQSMessages,
  checkCooldownForUpdate,
  drainQueue
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

      const messages = await drainQueue(logger, 10)
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

      const messages = await drainQueue(logger, 15)
      expect(sqsMockSend).toHaveBeenCalledTimes(3)
      expect(messages).toHaveLength(10)
      expect(infoSpy).toHaveBeenCalledTimes(3)
    })

    it("Does not return more than the maximum number of messages, even if more are available", async () => {
      const constructMessageArray = {Messages: Array.from({length: 10}, () => constructMessage())}
      const mockQueue = () => Promise.resolve(constructMessageArray)
      sqsMockSend.mockImplementation(mockQueue)

      const messages = await drainQueue(logger, 20)

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

      const messages = await drainQueue(logger, 20)
      expect(sqsMockSend).toHaveBeenCalledTimes(2)
      expect(messages).toHaveLength(14)
    })

    it("returns empty array if queue is empty on first fetch", async () => {
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Messages: []}))

      const messages = await drainQueue(logger, 5)
      expect(messages).toEqual([])
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
    })

    it("Throws an error if the SQS fetch fails", async () => {
      sqsMockSend.mockImplementation(() => Promise.reject(new Error("Fetch failed")))
      await expect(drainQueue(logger, 10)).rejects.toThrow("Fetch failed")
    })

    it("Throws an error if a message has no Body", async () => {
      const badMsg = constructMessage({Body: undefined})
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Messages: [badMsg]}))

      await expect(drainQueue(logger, 1)).rejects.toThrow(
        `Received an invalid SQS message. Message ID ${badMsg.MessageId}`
      )
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to parse SQS message - aborting this notification processor check.",
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

  describe("clearCompletedSQSMessages", () => {
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

      await expect(clearCompletedSQSMessages(logger, messages))
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

      await clearCompletedSQSMessages(logger, messages)
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

      await expect(clearCompletedSQSMessages(logger, messages))
        .rejects
        .toThrow("Failed to delete 1 messages from SQS")

      expect(errorSpy).toHaveBeenCalledWith(
        "Some messages failed to delete in this batch",
        {failed: failedEntries}
      )
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {clearCompletedSQSMessages: clearFunc} = await import("../src/utils")

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

      // first info for count
      expect(infoSpy).toHaveBeenCalledWith(
        "Attempting to push data to DynamoDB",
        {count: 1}
      )
      // error log includes PrescriptionID and the error
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to write to DynamoDB",
        {
          error: awsErr
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

      expect(infoSpy).toHaveBeenCalledWith("Upserted prescription")

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

      process.env = {...ORIGINAL_ENV, TABLE_NAME: "test-table"}

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

      expect(sendSpy).toHaveBeenCalledWith(expect.any(GetCommand))
      expect(infoSpy).toHaveBeenCalledWith(
        "No previous notification state found. Notification allowed."
      )
      expect(result).toBe(true)
    })

    it("returns true when last notification is older than default cooldown", async () => {
      const pastTs = new Date(Date.now() - (1000 * 901)).toISOString() // 901s ago
      sendSpy.mockImplementationOnce(() =>
        Promise.resolve({Item: {LastNotificationRequestTimestamp: pastTs}})
      )

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(infoSpy).toHaveBeenCalledWith(
        "Cooldown period has passed. Notification allowed.",
        expect.objectContaining({secondsSince: expect.any(Number)})
      )
      expect(result).toBe(true)
    })

    it("returns false when last notification is within default cooldown", async () => {
      const recentTs = new Date(Date.now() - (1000 * 300)).toISOString() // 300s ago
      sendSpy.mockImplementationOnce(() =>
        Promise.resolve({Item: {LastNotificationRequestTimestamp: recentTs}})
      )

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 900)

      expect(infoSpy).toHaveBeenCalledWith(
        "Within cooldown period. Notification suppressed.",
        expect.objectContaining({secondsSince: expect.any(Number)})
      )
      expect(result).toBe(false)
    })

    it("honours a custom cooldownPeriod", async () => {
      // custom cooldown = 60 seconds, but timestamp is only 30s ago
      const recentTs = new Date(Date.now() - 30000).toISOString()
      sendSpy.mockImplementationOnce(() =>
        Promise.resolve({Item: {LastNotificationRequestTimestamp: recentTs}})
      )

      const update = constructPSUDataItemMessage().PSUDataItem
      const result = await checkCooldownForUpdate(logger, update, 60)

      expect(infoSpy).toHaveBeenCalledWith(
        "Within cooldown period. Notification suppressed.",
        expect.objectContaining({secondsSince: expect.any(Number)})
      )
      expect(result).toBe(false)
    })

    it("propagates and logs errors from DynamoDB", async () => {
      const awsErr = new Error("DDB failure")
      sendSpy.mockImplementationOnce(() => Promise.reject(awsErr))

      const update = constructPSUDataItemMessage().PSUDataItem
      await expect(checkCooldownForUpdate(logger, update)).rejects.toThrow("DDB failure")
      expect(errorSpy).toHaveBeenCalledWith(
        "Error checking cooldown state",
        expect.objectContaining({error: awsErr})
      )
    })
  })
})
