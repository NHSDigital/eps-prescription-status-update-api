import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"
import {Message} from "@aws-sdk/client-sqs"

import {constructDataItem, mockSQSClient} from "./testHelpers"

const {mockSend: sqsMockSend} = mockSQSClient()

const {addPrescriptionToNotificationStateStore, drainQueue} = await import("../src/utils")

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
      const payload = {Messages: Array.from({length: 10}, () => (constructDataItem() as Message))}

      // Mock once for the fetch, and once for the delete
      sqsMockSend
        .mockImplementationOnce(() => Promise.resolve(payload))
        .mockImplementationOnce(() => Promise.resolve({Successful: []}))

      const messages = await drainQueue(logger, 10)
      expect(sqsMockSend).toHaveBeenCalledTimes(2)
      expect(messages).toStrictEqual(payload.Messages)
    })

    it("returns empty array if queue is empty on first fetch", async () => {
      sqsMockSend.mockImplementation(() => Promise.resolve({Messages: []}))

      const messages = await drainQueue(logger, 5)
      expect(messages).toEqual([])
      expect(sqsMockSend).toHaveBeenCalledTimes(1)
      // no deletion attempted
    })

    it("Throws an error if the SQS fetch fails", async () => {
      sqsMockSend.mockImplementation(() => Promise.reject(new Error("Fetch failed")))
      await expect(drainQueue(logger, 10)).rejects.toThrow("Fetch failed")
    })

    it("Throws an error if the delete batch operation fails", async () => {
      const msg = constructDataItem() as Message
      // first call: fetch, second call: delete
      sqsMockSend
        .mockImplementationOnce(() =>
          Promise.resolve({Messages: [msg]})
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            Failed: [{Id: msg.MessageId!, Message: "del-error", Code: "500"}]
          })
        )

      await expect(drainQueue(logger, 1)).rejects.toThrow("Failed to delete fetched messages from SQS")
      expect(errorSpy).toHaveBeenCalledWith(
        "Some messages failed to delete",
        {failed: expect.any(Array)}
      )
    })

    it("Throws an error if the SQS URL is not configured", async () => {
      delete process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
      const {drainQueue} = await import("../src/utils")

      await expect(drainQueue(logger)).rejects.toThrow("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
      expect(errorSpy).toHaveBeenCalledWith("Notifications SQS URL not configured")
    })
  })

  describe("addPrescriptionToNotificationStateStore", () => {
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
      const {addPrescriptionToNotificationStateStore} = await import("../src/utils")

      await expect(
        addPrescriptionToNotificationStateStore(logger, [constructDataItem()])
      ).rejects.toThrow("TABLE_NAME not set")

      expect(errorSpy).toHaveBeenCalledWith(
        "DynamoDB table not configured"
      )
      // ensure we never attempted to send
      expect(sendSpy).not.toHaveBeenCalled()
    })

    it("throws and logs error when a DynamoDB write fails", async () => {
      const item = constructDataItem()
      const awsErr = new Error("AWS error")
      sendSpy.mockImplementationOnce(() => Promise.reject(awsErr))

      await expect(
        addPrescriptionToNotificationStateStore(logger, [item])
      ).rejects.toThrow("AWS error")

      // first info for count
      expect(infoSpy).toHaveBeenCalledWith(
        "Pushing data to DynamoDB",
        {count: 1}
      )
      // error log includes PrescriptionID and the error
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to write to DynamoDB",
        {
          PrescriptionID: item.PrescriptionID,
          error: awsErr
        }
      )
    })

    it("puts data in DynamoDB and logs correctly when configured", async () => {
      const item = constructDataItem()
      sendSpy.mockImplementationOnce(() => Promise.resolve({}))

      await addPrescriptionToNotificationStateStore(logger, [item])

      // 1st info: pushing batch
      expect(infoSpy).toHaveBeenNthCalledWith(
        1,
        "Pushing data to DynamoDB",
        {count: 1}
      )
      // send was called exactly once with a PutCommand
      expect(sendSpy).toHaveBeenCalledTimes(1)
      const cmd = sendSpy.mock.calls[0][0] as PutCommand
      expect(cmd).toBeInstanceOf(PutCommand)
      // verify TTL injected
      expect(cmd.input).toEqual({
        TableName: "dummy_table",
        Item: {
          ...item,
          ExpiryTime: 86400
        }
      })

      // 2nd info: upsert log
      expect(infoSpy).toHaveBeenNthCalledWith(
        2,
        "Upserted prescription",
        {
          PrescriptionID: item.PrescriptionID,
          PatientNHSNumber: item.PatientNHSNumber
        }
      )

      expect(errorSpy).not.toHaveBeenCalled()
    })
  })
})
