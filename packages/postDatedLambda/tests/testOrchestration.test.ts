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
import {PostDatedSQSMessage} from "../src/types"

// Import the orchestration module after mocking dependencies
const {processMessages} = await import("../src/orchestration")

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
})
