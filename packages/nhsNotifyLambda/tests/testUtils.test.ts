import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {PutCommand} from "@aws-sdk/lib-dynamodb"

import {constructDataItem} from "./testHelpers"
const {addPrescriptionToNotificationStateStore} = await import("../src/utils")

const ORIGINAL_ENV = {...process.env}

describe("NHS notify lambda helper functions", () => {
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
  })
})
