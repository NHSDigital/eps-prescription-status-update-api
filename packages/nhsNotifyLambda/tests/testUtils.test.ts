import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"
import {DeleteMessageBatchCommand, Message} from "@aws-sdk/client-sqs"

import {constructMessage, constructPSUDataItemMessage, mockSQSClient} from "./testHelpers"

const {mockSend: sqsMockSend} = mockSQSClient()

const {
  addPrescriptionMessagesToNotificationStateStore,
  clearCompletedSQSMessages,
  drainQueue
} = await import("../src/utils")

const ORIGINAL_ENV = {...process.env}

describe("NHS notify lambda helper functions", () => {

  describe("drainQueue", () => {
    let logger: Logger
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "test-service"})
      errorSpy = jest.spyOn(logger, "error")
    })

    it("Does not throw an error when the SQS fetch succeeds", async () => {
      const payload = {Messages: Array.from({length: 10}, () => (constructMessage()))}

      sqsMockSend.mockImplementationOnce(() => Promise.resolve(payload))

      const messages = await drainQueue(logger, 10)
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
      expect(messages.length).toStrictEqual(payload.Messages.length)
    })

    it("returns empty array if queue is empty on first fetch", async () => {
      sqsMockSend.mockImplementation(() => Promise.resolve({Messages: []}))

      const messages = await drainQueue(logger, 5)
      expect(messages).toEqual([])
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
    })

    it("Throws an error if the SQS fetch fails", async () => {
      sqsMockSend.mockImplementation(() => Promise.reject(new Error("Fetch failed")))
      await expect(drainQueue(logger, 10)).rejects.toThrow("Fetch failed")
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {drainQueue} = await import("../src/utils")

      await expect(drainQueue(logger)).rejects.toThrow("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
      expect(errorSpy).toHaveBeenCalledWith("Notifications SQS URL not configured")
    })
  })

  describe("clearCompletedSQSMessages", () => {
    let logger: Logger
    let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      logger = new Logger({serviceName: "test-service"})
      errorSpy = jest.spyOn(logger, "error")
    })

    it("deletes messages successfully without error", async () => {
      const messages: Array<Message> = [
        {MessageId: "msg1", ReceiptHandle: "rh1"},
        {MessageId: "msg2", ReceiptHandle: "rh2"}
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

    it("logs and throws if some deletions fail", async () => {
      const messages: Array<Message> = [
        {MessageId: "msg1", ReceiptHandle: "rh1"}
      ]
      const failedEntries = [
        {Id: "msg1", SenderFault: true, Code: "Error", Message: "fail"}
      ]

      // partial failure
      sqsMockSend.mockImplementationOnce(() => Promise.resolve({Failed: failedEntries}))

      await expect(clearCompletedSQSMessages(logger, messages))
        .rejects
        .toThrow("Failed to delete fetched messages from SQS")

      expect(errorSpy).toHaveBeenCalledWith(
        "Some messages failed to delete",
        {failed: failedEntries}
      )
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {clearCompletedSQSMessages} = await import("../src/utils")

      await expect(clearCompletedSQSMessages(logger, []))
        .rejects
        .toThrow("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
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
      const {addPrescriptionMessagesToNotificationStateStore} = await import("../src/utils")

      await expect(
        addPrescriptionMessagesToNotificationStateStore(logger, [constructPSUDataItemMessage()])
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
  })
})
