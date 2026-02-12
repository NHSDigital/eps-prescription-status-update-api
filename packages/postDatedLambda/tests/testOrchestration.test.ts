import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

// Mock the imports from local modules
const mockDetermineAction = jest.fn()
const mockComputeTimeUntilMaturity = jest.fn().mockReturnValue(300)
jest.unstable_mockModule("../src/businessLogic", () => {
  return {
    determineAction: mockDetermineAction,
    computeTimeUntilMaturity: mockComputeTimeUntilMaturity
  }
})

const mockEnrichMessagesWithMostRecentDataItem = jest.fn()
jest.unstable_mockModule("../src/databaseClient", () => {
  return {
    enrichMessagesWithMostRecentDataItem: mockEnrichMessagesWithMostRecentDataItem
  }
})

const mockReceivePostDatedSQSMessages = jest.fn()
const mockReportQueueStatus = jest.fn()
const mockForwardSQSMessageToNotificationQueue = jest.fn()
const mockRemoveSQSMessage = jest.fn()
const mockReturnMessageToQueue = jest.fn()
jest.unstable_mockModule("../src/sqs", () => {
  return {
    receivePostDatedSQSMessages: mockReceivePostDatedSQSMessages,
    reportQueueStatus: mockReportQueueStatus,
    forwardSQSMessageToNotificationQueue: mockForwardSQSMessageToNotificationQueue,
    removeSQSMessage: mockRemoveSQSMessage,
    returnMessageToQueue: mockReturnMessageToQueue
  }
})

import {Logger} from "@aws-lambda-powertools/logger"

import {createMockPostModifiedDataItem} from "./testUtils"
import {PostDatedProcessingResult, PostDatedSQSMessage, PostDatedSQSMessageWithRecentDataItem} from "../src/types"

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

function enrich(messages: Array<PostDatedSQSMessage>): Array<PostDatedSQSMessageWithRecentDataItem> {
  return messages.map((message) => ({
    ...message,
    mostRecentRecord: undefined
  }))
}

describe("orchestration", () => {
  describe("processMessages", () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockForwardSQSMessageToNotificationQueue.mockReturnValue(Promise.resolve("forwarded-id"))
      mockRemoveSQSMessage.mockReturnValue(Promise.resolve())
      mockReturnMessageToQueue.mockReturnValue(Promise.resolve())
    })

    it("should process messages and categorize them correctly", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "3", Body: "Message 3", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      // Mock the enrichment function to return the same messages
      mockEnrichMessagesWithMostRecentDataItem.mockReturnValueOnce(enrich(mockMessages))

      // Mock determineAction to return action for each message
      mockDetermineAction
        .mockReturnValueOnce(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)
        .mockReturnValueOnce(PostDatedProcessingResult.REPROCESS)
        .mockReturnValueOnce(PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE)

      await processMessages(mockMessages, logger)
      expect(mockForwardSQSMessageToNotificationQueue).toHaveBeenCalledTimes(1)
      expect(mockReturnMessageToQueue).toHaveBeenCalledTimes(1)
      expect(mockRemoveSQSMessage).toHaveBeenCalledTimes(2)
    })

    it("should handle empty message array", async () => {
      mockEnrichMessagesWithMostRecentDataItem.mockReturnValueOnce([])

      await processMessages([], logger)

      expect(mockForwardSQSMessageToNotificationQueue).not.toHaveBeenCalled()
      expect(mockReturnMessageToQueue).not.toHaveBeenCalled()
      expect(mockRemoveSQSMessage).not.toHaveBeenCalled()
    })

    it("should pass enriched records into processMessage", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      const enrichedMessage: PostDatedSQSMessageWithRecentDataItem = {
        ...mockMessages[0],
        mostRecentRecord: undefined
      }

      mockEnrichMessagesWithMostRecentDataItem.mockReturnValueOnce([enrichedMessage])
      mockDetermineAction.mockReturnValue(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)

      await processMessages(mockMessages, logger)

      expect(mockDetermineAction).toHaveBeenCalledWith(logger, enrichedMessage)
    })
  })

  describe("processPostDatedQueue", () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockForwardSQSMessageToNotificationQueue.mockReturnValue(Promise.resolve("forwarded-id"))
      mockRemoveSQSMessage.mockReturnValue(Promise.resolve())
      mockReturnMessageToQueue.mockReturnValue(Promise.resolve())
    })

    it("should process the SQS queue correctly", async () => {
      const mockMessages: Array<PostDatedSQSMessage> = [
        {MessageId: "1", Body: "Message 1", prescriptionData: createMockPostModifiedDataItem({})},
        {MessageId: "2", Body: "Message 2", prescriptionData: createMockPostModifiedDataItem({})}
      ]

      const mockEnrichedMessages = mockMessages.map((message) => ({
        ...message,
        mostRecentRecord: undefined
      }))

      mockReceivePostDatedSQSMessages.mockReturnValueOnce(mockMessages)
      mockEnrichMessagesWithMostRecentDataItem.mockReturnValueOnce(mockEnrichedMessages)
      mockDetermineAction.mockReturnValue(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)

      await processPostDatedQueue(logger)

      expect(mockReceivePostDatedSQSMessages).toHaveBeenCalledWith(logger)
      expect(mockReportQueueStatus).not.toHaveBeenCalled()
      expect(mockForwardSQSMessageToNotificationQueue).toHaveBeenCalledTimes(mockMessages.length)
      expect(mockRemoveSQSMessage).toHaveBeenCalledTimes(mockMessages.length)
      expect(mockReturnMessageToQueue).not.toHaveBeenCalled()
      expect(mockDetermineAction).toHaveBeenCalledTimes(mockMessages.length)
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
      mockEnrichMessagesWithMostRecentDataItem.mockReturnValue(enrich(mockMessages))
      const {MAX_QUEUE_RUNTIME} = await import("../src/orchestration")
      mockDetermineAction.mockReturnValue(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)

      const promise = processPostDatedQueue(logger)
      // Overrun by a second
      jest.advanceTimersByTime(MAX_QUEUE_RUNTIME + 1000)
      await promise

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
      mockEnrichMessagesWithMostRecentDataItem
        .mockReturnValueOnce(enrich(batch1))
        .mockReturnValueOnce(enrich(batch2))
        .mockReturnValueOnce(enrich(batch3))
      mockDetermineAction.mockReturnValue(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)

      await processPostDatedQueue(logger)

      expect(mockReceivePostDatedSQSMessages).toHaveBeenCalledTimes(3)
      expect(mockForwardSQSMessageToNotificationQueue)
        .toHaveBeenCalledTimes(batch1.length + batch2.length + batch3.length)
      expect(mockRemoveSQSMessage).toHaveBeenCalledTimes(batch1.length + batch2.length + batch3.length)
      expect(mockReportQueueStatus).not.toHaveBeenCalled()
      const totalMessages = batch1.length + batch2.length + batch3.length
      expect(mockDetermineAction).toHaveBeenCalledTimes(totalMessages)
    })

    it("should treat empty receives as drained batches", async () => {
      mockReceivePostDatedSQSMessages.mockReturnValueOnce([])
      mockEnrichMessagesWithMostRecentDataItem.mockReturnValueOnce([])

      await processPostDatedQueue(logger)

      expect(mockForwardSQSMessageToNotificationQueue).not.toHaveBeenCalled()
      expect(mockRemoveSQSMessage).not.toHaveBeenCalled()
      expect(mockReturnMessageToQueue).not.toHaveBeenCalled()
    })
  })
})
