import {
  describe,
  it,
  expect,
  jest
} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {LogItemMessage, LogItemExtraInput} from "@aws-lambda-powertools/logger/lib/cjs/types/Logger"
import * as sqs from "@aws-sdk/client-sqs"
import {PostDatedSQSMessage} from "../src/types"
import {createMockPostModifiedDataItem} from "./testUtils"

export function mockSQSClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-sqs", () => {
    return {
      ...sqs,
      SQSClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

const {mockSend} = mockSQSClient()

const {
  getPostDatedQueueUrl,
  reportQueueStatus,
  receivePostDatedSQSMessages,
  removeSQSMessage,
  returnMessageToQueue,
  forwardSQSMessageToNotificationQueue
} = await import("../src/sqs")

const ORIGINAL_ENV = {...process.env}

describe("sqs", () => {
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  // let warnSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Reset environment
    process.env = {...ORIGINAL_ENV}
    delete process.env.SQS_SALT

    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
    // warnSpy = jest.spyOn(logger, "warn")
  })

  describe("getPostDatedQueueUrl", () => {
    it("Should return the SQS queue URL from environment variables", () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const result = getPostDatedQueueUrl(logger)
      expect(result).toBe(testUrl)
    })

    it("Should throw an error if the SQS queue URL is not configured", () => {
      delete process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL

      expect(() => getPostDatedQueueUrl(logger)).toThrow("POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL not set")
      expect(errorSpy).toHaveBeenCalledWith("Post-dated prescriptions SQS URL not configured")
    })
  })

  describe("reportQueueStatus", () => {
    it("Should report the current status of the SQS queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response
      mockSend.mockReturnValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: "5",
          ApproximateNumberOfMessagesNotVisible: "2",
          ApproximateNumberOfMessagesDelayed: "1"
        }
      })

      await reportQueueStatus(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith(
        "Current post-dated queue attributes (if a value failed to fetch, it will be reported as -1):",
        {
          ApproximateNumberOfMessages: 5,
          ApproximateNumberOfMessagesNotVisible: 2,
          ApproximateNumberOfMessagesDelayed: 1
        }
      )
    })

    it("Should handle missing attributes gracefully", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response with missing attributes
      mockSend.mockReturnValueOnce({
        Attributes: {}
      })

      await reportQueueStatus(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith(
        "Current post-dated queue attributes (if a value failed to fetch, it will be reported as -1):",
        {
          ApproximateNumberOfMessages: -1,
          ApproximateNumberOfMessagesNotVisible: -1,
          ApproximateNumberOfMessagesDelayed: -1
        }
      )
    })
  })

  describe("receivePostDatedSQSMessages", () => {
    it("Should receive messages from the SQS queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response with messages
      const mockMessages = [
        {
          MessageId: "1",
          Body: JSON.stringify({PrescriptionID: "presc1"}),
          Attributes: {MessageDeduplicationId: "dedup1", MessageGroupId: "group1"}
        },
        {
          MessageId: "2",
          Body: JSON.stringify({PrescriptionID: "presc2"}),
          Attributes: {MessageDeduplicationId: "dedup2", MessageGroupId: "group2"}
        }
      ]
      mockSend.mockReturnValueOnce({
        Messages: mockMessages
      })

      const result = await receivePostDatedSQSMessages(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      const receiveCommand = mockSend.mock.calls[0][0] as {
        input: {MessageAttributeNames?: Array<string>; MessageSystemAttributeNames?: Array<string>}
      }
      expect(receiveCommand.input.MessageSystemAttributeNames).toEqual(["MessageDeduplicationId", "MessageGroupId"])
      expect(receiveCommand.input.MessageAttributeNames).toEqual(["All"])
      expect(result).toHaveLength(2)
      expect(result[0].MessageId).toBe("1")
      expect(result[0].prescriptionData.PrescriptionID).toBe("presc1")
      expect(result[1].MessageId).toBe("2")
      expect(result[1].prescriptionData.PrescriptionID).toBe("presc2")
    })

    it("Should return an empty array if no messages are received", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response with no messages
      mockSend.mockReturnValueOnce({
        Messages: []
      })

      const result = await receivePostDatedSQSMessages(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(0)
    })
  })

  describe("forwardSQSMessageToNotificationQueue", () => {
    it("should send a matured post-dated message to the notifications queue", async () => {
      const notifyUrl = "https://sqs.eu-west-2.amazonaws.com/123456789012/notify"
      process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL = notifyUrl

      const message: PostDatedSQSMessage = {
        MessageId: "1",
        ReceiptHandle: "handle-1",
        prescriptionData: createMockPostModifiedDataItem({RequestID: "req-1"}),
        Attributes: {MessageDeduplicationId: "dedup1", MessageGroupId: "group1"}
      }

      mockSend.mockReturnValueOnce({
        Successful: [{Id: "0", MessageId: "notify-msg-1"}],
        Failed: []
      })

      const result = await forwardSQSMessageToNotificationQueue(logger, message)

      expect(mockSend).toHaveBeenCalledTimes(1)
      const command = mockSend.mock.calls[0][0] as {input: {QueueUrl: string; Entries: Array<{MessageBody: string}>}}
      expect(command.input.QueueUrl).toBe(notifyUrl)
      expect(command.input.Entries[0].MessageBody).toBe(JSON.stringify(message.prescriptionData))
      expect(result).toBe("notify-msg-1")
    })

    it("should throw an error if the deduplication ID is missing", async () => {
      process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL = "https://sqs.eu-west-2.amazonaws.com/123456789012/notify"

      const message: PostDatedSQSMessage = {
        MessageId: "1",
        ReceiptHandle: "handle-1",
        prescriptionData: createMockPostModifiedDataItem({RequestID: "req-1"}),
        Attributes: {} // Missing MessageDeduplicationId
      }

      await expect(
        forwardSQSMessageToNotificationQueue(logger, message)
      ).rejects.toThrow("Missing MessageDeduplicationId in SQS message attributes")

      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe("removeSQSMessage", () => {
    it("Should remove a message from the SQS queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messageToRemove = {MessageId: "1", ReceiptHandle: "handle1"}

      // Mock SQS delete response
      mockSend.mockReturnValueOnce({
        Successful: [{Id: messageToRemove.MessageId}],
        Failed: []
      })

      await removeSQSMessage(logger, messageToRemove)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("Successfully removed 1 messages from SQS")
    })

    it("Should log errors but not throw if deletion fails", async () => {
      // We don't want to throw on failed deletions, as this would cause
      // later batches to be skipped unnecessarily.
      // The messages that are failed to delete will become visible and be processed again after the visibility timeout
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messageToRemove = {MessageId: "1", ReceiptHandle: "handle1"}

      // Mock SQS delete response with failures
      mockSend.mockReturnValueOnce({
        Successful: [],
        Failed: [{Id: "1", Message: "Some error"}]
      })

      await removeSQSMessage(logger, messageToRemove)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith("Some messages failed to delete", {
        failed: [{Id: "1", Message: "Some error"}]
      })
    })
  })

  describe("returnMessageToQueue", () => {
    it("Should return a message to the SQS queue by updating its visibility timeout", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messageToReturn: PostDatedSQSMessage = {
        MessageId: "1",
        ReceiptHandle: "handle1",
        prescriptionData: createMockPostModifiedDataItem({})
      }

      // Mock SQS change visibility response
      mockSend.mockReturnValueOnce({
        // No specific return value needed for ChangeMessageVisibilityBatch
      })

      await returnMessageToQueue(logger, messageToReturn)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("Returning message to queue with timeouts", {
        sqsMessage: messageToReturn,
        visibilityTimeout: 300
      })
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it("should log an error if SQS change visibility fails", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messageToReturn: PostDatedSQSMessage = {
        MessageId: "1",
        ReceiptHandle: "handle1",
        prescriptionData: createMockPostModifiedDataItem({})
      }

      // Mock SQS change visibility to throw an error
      const expectedError = new Error("SQS change visibility failed")
      mockSend.mockReturnValueOnce(Promise.reject(expectedError))

      await returnMessageToQueue(logger, messageToReturn)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith("SQS change visibility failed", {error: expectedError})
    })
  })
})
