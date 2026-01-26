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
import {BatchProcessingResult, PostDatedSQSMessage} from "../src/types"
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
  getQueueUrl,
  reportQueueStatus,
  receivePostDatedSQSMessages,
  removeSQSMessages,
  returnMessagesToQueue,
  handleProcessedMessages
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

    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
    // warnSpy = jest.spyOn(logger, "warn")
  })

  describe("getQueueUrl", () => {
    it("Should return the SQS queue URL from environment variables", () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const result = getQueueUrl(logger)
      expect(result).toBe(testUrl)
    })

    it("Should throw an error if the SQS queue URL is not configured", () => {
      delete process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL

      expect(() => getQueueUrl(logger)).toThrow("POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL not set")
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
          Body: JSON.stringify({PrescriptionID: "presc1"})
        },
        {
          MessageId: "2",
          Body: JSON.stringify({PrescriptionID: "presc2"})
        }
      ]
      mockSend.mockReturnValueOnce({
        Messages: mockMessages
      })

      const result = await receivePostDatedSQSMessages(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
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

  describe("removeSQSMessages", () => {
    it("Should remove messages from the SQS queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messagesToRemove = [
        {MessageId: "1", ReceiptHandle: "handle1"},
        {MessageId: "2", ReceiptHandle: "handle2"}
      ]

      // Mock SQS delete response
      mockSend.mockReturnValueOnce({
        Successful: messagesToRemove.map((msg) => ({Id: msg.MessageId})),
        Failed: []
      })

      await removeSQSMessages(logger, messagesToRemove)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("Successfully removed 2 messages from SQS")
    })

    it("Should handle empty message array gracefully", async () => {
      await removeSQSMessages(logger, [])

      expect(mockSend).toHaveBeenCalledTimes(0)
      expect(infoSpy).toHaveBeenCalledWith("No messages to delete")
    })

    it("Should log errors but not throw if deletion fails", async () => {
      // We don't want to throw on failed deletions, as this would cause
      // later batches to be skipped unnecessarily.
      // The messages that are failed to delete will become visible and be processed again after the visibility timeout
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messagesToRemove = [
        {MessageId: "1", ReceiptHandle: "handle1"},
        {MessageId: "2", ReceiptHandle: "handle2"}
      ]

      // Mock SQS delete response with failures
      mockSend.mockReturnValueOnce({
        Successful: [{Id: "1"}],
        Failed: [{Id: "2", Message: "Some error"}]
      })

      await removeSQSMessages(logger, messagesToRemove)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith("Some messages failed to delete", {
        failed: [{Id: "2", Message: "Some error"}]
      })
      expect(infoSpy).toHaveBeenCalledWith("Successfully removed 1 messages from SQS")
    })
  })

  describe("returnMessagesToQueue", () => {
    it("Should return messages to the SQS queue by updating their visibility timeout", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messagesToReturn = [
        {MessageId: "1", ReceiptHandle: "handle1"},
        {MessageId: "2", ReceiptHandle: "handle2"}
      ]

      // Mock SQS change visibility response
      mockSend.mockReturnValueOnce({
        // No specific return value needed for ChangeMessageVisibilityBatch
      })

      await returnMessagesToQueue(logger, messagesToReturn)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith("Returning messages to queue with timeouts", {
        numberOfMessages: 2,
        idAndTimeouts: [
          {id: "1", visibilityTimeout: 300},
          {id: "2", visibilityTimeout: 300}
        ]
      })
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it("Should handle empty message array gracefully", async () => {
      await returnMessagesToQueue(logger, [])

      expect(mockSend).toHaveBeenCalledTimes(0)
      expect(infoSpy).toHaveBeenCalledWith("No messages to return to queue")
    })

    it("should log an error if SQS change visibility fails", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const messagesToReturn = [
        {MessageId: "1", ReceiptHandle: "handle1"}
      ]

      // Mock SQS change visibility to throw an error
      const expectedError = new Error("SQS change visibility failed")
      mockSend.mockImplementationOnce(() => {
        throw expectedError
      })

      await returnMessagesToQueue(logger, messagesToReturn)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith("SQS change visibility failed", {error: expectedError})
    })
  })

  describe("handleProcessedMessages", () => {
    it("should remove matured messages and return immature messages to the queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const maturedMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", ReceiptHandle: "handle1", prescriptionData: createMockPostModifiedDataItem({})}
      ]
      const immatureMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "2", ReceiptHandle: "handle2", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      const batchResult: BatchProcessingResult = {
        maturedPrescriptionUpdates: maturedMessages,
        immaturePrescriptionUpdates: immatureMessages
      }

      // Mock SQS responses
      mockSend
        .mockReturnValueOnce({
          Successful: [{Id: "1"}],
          Failed: []
        }) // For removeSQSMessages
        .mockReturnValueOnce({}) // For returnMessagesToQueue

      await handleProcessedMessages(batchResult, logger)

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(infoSpy).toHaveBeenCalledWith("Successfully removed 1 messages from SQS")
      expect(infoSpy).toHaveBeenCalledWith("Returning messages to queue with timeouts", {
        numberOfMessages: 1,
        idAndTimeouts: [
          {id: "2", visibilityTimeout: 300}
        ]
      })
    })

    it("should handle empty matured and immature message arrays gracefully", async () => {
      const batchResult: BatchProcessingResult = {
        maturedPrescriptionUpdates: [],
        immaturePrescriptionUpdates: []
      }

      await handleProcessedMessages(batchResult, logger)

      expect(mockSend).toHaveBeenCalledTimes(0)
      expect(infoSpy).not.toHaveBeenCalledWith("Successfully removed")
      expect(infoSpy).not.toHaveBeenCalledWith("Returning messages to queue with timeouts", expect.anything())
    })
  })
})
