import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {constructDataItem} from "./testHelpers"

const ORIGINAL_ENV = {...process.env}

const {addPrescriptionToNotificationStateStore} = await import("../src/utils")

const logger = new Logger({serviceName: "test-service"})

describe("utils", () => {
  let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
  let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
  let dynamoSendSpy: ReturnType<typeof jest.spyOn>

  describe("addPrescriptionToNotificationStateStore", () => {

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      process.env = {...ORIGINAL_ENV}
      console.log("Table name", process.env.TABLE_NAME)

      infoSpy = jest.spyOn(logger, "info")
      errorSpy = jest.spyOn(logger, "error")

      dynamoSendSpy = jest.spyOn(DynamoDBDocumentClient.prototype, "send")
    })

    it("Puts data in dynamo if the table name is configured and the send is successful", async () => {
      dynamoSendSpy.mockImplementationOnce(() => Promise.resolve())
      addPrescriptionToNotificationStateStore(logger, [constructDataItem()])

      expect(errorSpy).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalled()
      expect(dynamoSendSpy).toHaveBeenCalled()
    })
  })
})
