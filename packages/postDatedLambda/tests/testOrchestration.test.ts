import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

// Mock the imports from local modules
const mockProcessMessage = jest.fn()
jest.unstable_mockModule("../src/businessLogic", () => {
  return {
    processMessage: mockProcessMessage
  }
})

const mockEnrichMessagesWithExistingRecords = jest.fn()
jest.unstable_mockModule("../src/databaseClient", () => {
  return {
    enrichMessagesWithExistingRecords: mockEnrichMessagesWithExistingRecords
  }
})

const mockReceivePostDatedSQSMessages = jest.fn()
const mockReportQueueStatus = jest.fn()
const mockHandleProcessedMessages = jest.fn()
jest.unstable_mockModule("../src/sqs", () => {
  return {
    receivePostDatedSQSMessages: mockReceivePostDatedSQSMessages,
    reportQueueStatus: mockReportQueueStatus,
    handleProcessedMessages: mockHandleProcessedMessages
  }
})

import {Logger} from "@aws-lambda-powertools/logger"

import {createMockPostModifiedDataItem} from "./testUtils"
import {BatchProcessingResult, PostDatedSQSMessage} from "../src/types"

// Import the orchestration module after mocking dependencies
const {processMessages, processPostDatedQueue} = await import("../src/orchestration")

const logger = new Logger({serviceName: "postDatedLambdaTEST"})

describe("orchestration", () => {
  describe("processMessages", () => {
    it("should process messages and categorize them correctly", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      // Mock the enrichment function to return the same messages
      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce(mockMessages)

      // Mock processMessage to return true for first message and false for second
      mockProcessMessage.mockReturnValueOnce(true)
      mockProcessMessage.mockReturnValueOnce(false)

      const result = await processMessages(mockMessages, logger)

      expect(result.maturedPrescriptionUpdates).toHaveLength(1)
      expect(result.maturedPrescriptionUpdates[0].MessageId).toBe("1")
      expect(result.immaturePrescriptionUpdates).toHaveLength(1)
      expect(result.immaturePrescriptionUpdates[0].MessageId).toBe("2")
    })

    it("should handle empty message array", async () => {
      const result = await processMessages([], logger)

      expect(result.maturedPrescriptionUpdates).toHaveLength(0)
      expect(result.immaturePrescriptionUpdates).toHaveLength(0)
    })
  })

  describe("processPostDatedQueue", () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it("should process the SQS queue correctly", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      const mockEnrichedMessages = mockMessages.map((message) => ({
        ...message,
        existingRecords: []
      }))

      mockReceivePostDatedSQSMessages.mockReturnValueOnce(mockMessages)
      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce(mockEnrichedMessages)
      mockProcessMessage.mockReturnValue(true)

      await processPostDatedQueue(logger)

      expect(mockReceivePostDatedSQSMessages).toHaveBeenCalledWith(logger)
      expect(mockReportQueueStatus).not.toHaveBeenCalled()
      expect(mockHandleProcessedMessages).toHaveBeenCalled()
      const [res, lg] =
        mockHandleProcessedMessages.mock.calls[0] as [BatchProcessingResult, Logger]
      expect(lg).toBe(logger)
      expect(res.maturedPrescriptionUpdates).toHaveLength(mockMessages.length)
      expect(res.immaturePrescriptionUpdates).toHaveLength(0)
      expect(res.maturedPrescriptionUpdates.map((message) => message.MessageId)).toEqual(
        mockMessages.map((message) => message.MessageId)
      )
      expect(mockProcessMessage).toHaveBeenCalledTimes(mockMessages.length)
    })

    it("Should stop processing if the max runtime is exceeded", async () => {
      jest.useFakeTimers()
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "3", Body: "Message 3", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "4", Body: "Message 4", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "5", Body: "Message 5", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "6", Body: "Message 6", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      mockReceivePostDatedSQSMessages.mockReturnValue(mockMessages)
      mockEnrichMessagesWithExistingRecords.mockReturnValue(
        mockMessages.map((message) => ({
          ...message,
          existingRecords: []
        }))
      )
      const {MAX_QUEUE_RUNTIME} = await import("../src/orchestration")
      mockProcessMessage.mockImplementation(async () => {
        // Overrun by a second
        jest.advanceTimersByTime(MAX_QUEUE_RUNTIME + 1000)
        return true
      })

      await processPostDatedQueue(logger)

      expect(mockReportQueueStatus).toHaveBeenCalled()
      jest.useRealTimers()
    })
  })
})
