import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

// Mock the imports from local modules
const mockProcessMessage = jest.fn()
const mockComputeTimeUntilMaturity = jest.fn().mockReturnValue(300)
jest.unstable_mockModule("../src/businessLogic", () => {
  return {
    processMessage: mockProcessMessage,
    computeTimeUntilMaturity: mockComputeTimeUntilMaturity
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
import {BatchProcessingResult, PostDatedProcessingResult, PostDatedSQSMessage} from "../src/types"

// Import the orchestration module after mocking dependencies
const {processMessages, processPostDatedQueue} = await import("../src/orchestration")

const logger = new Logger({serviceName: "postDatedLambdaTEST"})

// I needed to move these functions out of the describe block since it was too deeply nested.
function createBatch(ids: Array<string>): Array<PostDatedSQSMessage> {
  return ids.map((id) => ({
    MessageId: id,
    Body: `Message ${id}`,
    prescriptionData: createMockPostModifiedDataItem({})
  }))
}

function enrich(messages: Array<PostDatedSQSMessage>) {
  return messages.map((message) => ({
    ...message,
    existingRecords: []
  }))
}

describe("orchestration", () => {
  describe("processMessages", () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it("should process messages and categorize them correctly", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "3", Body: "Message 3", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      // Mock the enrichment function to return the same messages
      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce(mockMessages)

      // Mock processMessage to return true for first message and false for second
      mockProcessMessage
        .mockReturnValueOnce(PostDatedProcessingResult.MATURED)
        .mockReturnValueOnce(PostDatedProcessingResult.IMMATURE)
        .mockReturnValueOnce(PostDatedProcessingResult.IGNORE)

      const result = await processMessages(mockMessages, logger)

      expect(result.maturedPrescriptionUpdates).toHaveLength(1)
      expect(result.maturedPrescriptionUpdates[0].MessageId).toBe("1")
      expect(result.immaturePrescriptionUpdates).toHaveLength(1)
      expect(result.immaturePrescriptionUpdates[0].MessageId).toBe("2")
      expect(result.ignoredPrescriptionUpdates).toHaveLength(1)
      expect(result.ignoredPrescriptionUpdates[0].MessageId).toBe("3")
    })

    it("should handle empty message array", async () => {
      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce([])
      const result = await processMessages([], logger)

      expect(result.maturedPrescriptionUpdates).toHaveLength(0)
      expect(result.immaturePrescriptionUpdates).toHaveLength(0)
      expect(result.ignoredPrescriptionUpdates).toHaveLength(0)
    })

    it("should log errors and mark messages immature when processing throws", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce(mockMessages)
      mockProcessMessage
        .mockReturnValueOnce(PostDatedProcessingResult.MATURED)
        .mockImplementationOnce(() => {
          throw new Error("processing failed")
        })

      const errorSpy = jest.spyOn(logger, "error")
      const result = await processMessages(mockMessages, logger)

      expect(result.maturedPrescriptionUpdates).toHaveLength(1)
      expect(result.immaturePrescriptionUpdates).toHaveLength(1)
      expect(result.ignoredPrescriptionUpdates).toHaveLength(0)
      expect(result.immaturePrescriptionUpdates[0].MessageId).toBe("2")
      expect(errorSpy).toHaveBeenCalledWith(
        "Error processing message",
        expect.objectContaining({messageId: "2"})
      )
      errorSpy.mockRestore()
    })

    it("should pass enriched records into processMessage", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      const enrichedMessage = {
        ...mockMessages[0],
        existingRecords: [{prescriptionId: "abc"}]
      }

      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce([enrichedMessage])
      mockProcessMessage.mockReturnValue(PostDatedProcessingResult.MATURED)

      await processMessages(mockMessages, logger)

      expect(mockProcessMessage).toHaveBeenCalledWith(logger, enrichedMessage)
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
      mockProcessMessage.mockReturnValue(PostDatedProcessingResult.MATURED)

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
        return PostDatedProcessingResult.MATURED
      })

      await processPostDatedQueue(logger)

      expect(mockReportQueueStatus).toHaveBeenCalled()
      jest.useRealTimers()
    })

    it("should continue processing batches until message count drops below threshold", async () => {
      const batch1 = createBatch(["1", "2", "3"])
      const batch2 = createBatch(["4", "5", "6"])
      const batch3 = createBatch(["7"])

      mockReceivePostDatedSQSMessages
        .mockReturnValueOnce(batch1)
        .mockReturnValueOnce(batch2)
        .mockReturnValueOnce(batch3)
      mockEnrichMessagesWithExistingRecords
        .mockReturnValueOnce(enrich(batch1))
        .mockReturnValueOnce(enrich(batch2))
        .mockReturnValueOnce(enrich(batch3))
      mockProcessMessage.mockReturnValue(PostDatedProcessingResult.MATURED)

      await processPostDatedQueue(logger)

      expect(mockReceivePostDatedSQSMessages).toHaveBeenCalledTimes(3)
      expect(mockHandleProcessedMessages).toHaveBeenCalledTimes(3)
      expect(mockReportQueueStatus).not.toHaveBeenCalled()
      const totalMessages = batch1.length + batch2.length + batch3.length
      expect(mockProcessMessage).toHaveBeenCalledTimes(totalMessages)
    })

    it("should treat empty receives as drained batches", async () => {
      mockReceivePostDatedSQSMessages.mockReturnValueOnce([])
      mockEnrichMessagesWithExistingRecords.mockReturnValueOnce([])

      await processPostDatedQueue(logger)

      expect(mockHandleProcessedMessages).toHaveBeenCalledTimes(1)
      const [result] = mockHandleProcessedMessages.mock.calls[0] as [BatchProcessingResult]
      expect(result.maturedPrescriptionUpdates).toHaveLength(0)
      expect(result.immaturePrescriptionUpdates).toHaveLength(0)
    })
  })
})
