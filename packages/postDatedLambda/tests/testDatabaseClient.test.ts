import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import * as dynamo from "@aws-sdk/client-dynamodb"

import {Logger} from "@aws-lambda-powertools/logger"

import {createMockPostModifiedDataItem} from "./testUtils"

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockDynamoDBClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-dynamodb", () => {
    return {
      ...dynamo,
      DynamoDBClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

const {mockSend} = mockDynamoDBClient()
const {
  getRecentDataItemByPrescriptionID,
  enrichMessagesWithMostRecentDataItem
} = await import("../src/databaseClient")

const logger = new Logger({serviceName: "postDatedLambdaTEST"})

describe("databaseClient", () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe("getRecentDataItemByPrescriptionID", () => {
    it("should return existing records from DynamoDB", async () => {
      const prescriptionID = "testPrescID"

      // Mock DynamoDB response
      const mockItems = [
        {
          PrescriptionID: {S: prescriptionID},
          Status: {S: "With pharmacy"},
          LastModified: {S: "2024-01-01T12:00:00Z"}
        },
        {
          PrescriptionID: {S: prescriptionID},
          Status: {S: "Ready to collect"},
          LastModified: {S: "2023-12-31T12:00:00Z"}
        }
      ]

      mockSend.mockReturnValueOnce({
        Items: mockItems,
        LastEvaluatedKey: undefined
      })

      const records = await getRecentDataItemByPrescriptionID(
        prescriptionID,
        logger
      )

      expect(records).toHaveLength(2)
      expect(records[0].Status).toBe("With pharmacy")
      expect(records[1].Status).toBe("Ready to collect")
    })

    it("should return an empty array when DynamoDB returns no items", async () => {
      const prescriptionID = "noRecordsPrescID"

      mockSend.mockReturnValueOnce({
        Items: [],
        LastEvaluatedKey: undefined
      })

      const records = await getRecentDataItemByPrescriptionID(prescriptionID, logger)

      expect(records).toEqual([])
    })

    it("Should log and throw an error if the DynamoDB query fails", async () => {
      const prescriptionID = "errorPrescID"

      // Mock DynamoDB to throw an error
      const mockError = new Error("DynamoDB query failed")
      mockSend.mockReturnValueOnce(Promise.reject(mockError))

      await expect(
        getRecentDataItemByPrescriptionID(
          prescriptionID,
          logger
        )
      ).rejects.toThrow("DynamoDB query failed")
    })

    it("should paginate through multiple DynamoDB result pages", async () => {
      const prescriptionID = "pagedPrescID"

      const firstPageItems = [
        {
          PrescriptionID: {S: prescriptionID},
          Status: {S: "Ready to collect"},
          LastModified: {S: "2024-01-01T12:00:00Z"}
        }
      ]

      const secondPageItems = [
        {
          PrescriptionID: {S: prescriptionID},
          Status: {S: "With pharmacy"},
          LastModified: {S: "2024-01-02T12:00:00Z"}
        }
      ]

      mockSend
        .mockReturnValueOnce({
          Items: firstPageItems,
          LastEvaluatedKey: {
            PrescriptionID: {S: prescriptionID}
          }
        })
        .mockReturnValueOnce({
          Items: secondPageItems,
          LastEvaluatedKey: undefined
        })

      const records = await getRecentDataItemByPrescriptionID(prescriptionID, logger)

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(records).toHaveLength(2)
      expect(records[0].Status).toBe("Ready to collect")
      expect(records[1].Status).toBe("With pharmacy")
    })
  })

  describe("enrichMessagesWithMostRecentDataItem", () => {
    it("should enrich messages with the most recent record", async () => {
      const prescriptions = [
        createMockPostModifiedDataItem({PrescriptionID: "presc1", PharmacyODSCode: "pharmA"}),
        createMockPostModifiedDataItem({PrescriptionID: "presc2", PharmacyODSCode: "pharmB"})
      ]

      // Mock DynamoDB responses
      const mockItemsPresc1 = [
        {
          PrescriptionID: {S: "presc1"},
          PharmacyODSCode: {S: "pharmA"},
          Status: {S: "With pharmacy"},
          LastModified: {S: "2024-01-01T12:00:00Z"}
        },
        {
          PrescriptionID: {S: "presc1"},
          PharmacyODSCode: {S: "pharmA"},
          Status: {S: "Ready to collect"},
          LastModified: {S: "2024-01-03T12:00:00Z"}
        }
      ]

      const mockItemsPresc2 = [
        {
          PrescriptionID: {S: "presc2"},
          PharmacyODSCode: {S: "pharmB"},
          Status: {S: "Ready to collect"},
          LastModified: {S: "2024-01-02T12:00:00Z"}
        }
      ]

      mockSend
        .mockReturnValueOnce({
          Items: mockItemsPresc1,
          LastEvaluatedKey: undefined
        })
        .mockReturnValueOnce({
          Items: mockItemsPresc2,
          LastEvaluatedKey: undefined
        })

      const messages = prescriptions.map((presc) => ({
        prescriptionData: presc
      }))

      const enrichedMessages = await enrichMessagesWithMostRecentDataItem(
        messages,
        logger
      )

      expect(enrichedMessages.length).toBe(2)
      expect(enrichedMessages[0].mostRecentRecord?.Status).toBe("Ready to collect")
      expect(enrichedMessages[1].mostRecentRecord?.Status).toBe("Ready to collect")
    })

    it("should return an empty array when no messages are provided", async () => {
      const enrichedMessages = await enrichMessagesWithMostRecentDataItem([], logger)

      expect(enrichedMessages).toEqual([])
    })

    it("should set mostRecentRecord to undefined when DynamoDB has no matches", async () => {
      const prescriptions = [
        createMockPostModifiedDataItem({PrescriptionID: "noPresc1", PharmacyODSCode: "pharmA"}),
        createMockPostModifiedDataItem({PrescriptionID: "noPresc2", PharmacyODSCode: "pharmB"})
      ]

      mockSend
        .mockReturnValueOnce({
          Items: [],
          LastEvaluatedKey: undefined
        })
        .mockReturnValueOnce({
          Items: [],
          LastEvaluatedKey: undefined
        })

      const messages = prescriptions.map((presc) => ({
        prescriptionData: presc
      }))

      const enrichedMessages = await enrichMessagesWithMostRecentDataItem(messages, logger)

      expect(enrichedMessages).toHaveLength(2)
      expect(enrichedMessages[0].mostRecentRecord).toBeUndefined()
      expect(enrichedMessages[1].mostRecentRecord).toBeUndefined()
    })

    it("should keep processing when one prescription lookup fails", async () => {
      const prescriptions = [
        createMockPostModifiedDataItem({PrescriptionID: "presc1", PharmacyODSCode: "pharmA"}),
        createMockPostModifiedDataItem({PrescriptionID: "errorPresc", PharmacyODSCode: "errorPharm"})
      ]

      const mockItemsPresc1 = [
        {
          PrescriptionID: {S: "presc1"},
          PharmacyODSCode: {S: "pharmA"},
          Status: {S: "With pharmacy"},
          LastModified: {S: "2024-01-01T12:00:00Z"}
        }
      ]

      mockSend
        .mockReturnValueOnce({
          Items: mockItemsPresc1,
          LastEvaluatedKey: undefined
        })
        .mockReturnValueOnce(Promise.reject(new Error("DynamoDB query failed")))

      const messages = prescriptions.map((presc) => ({
        prescriptionData: presc
      }))

      const enrichedMessages = await enrichMessagesWithMostRecentDataItem(messages, logger)

      expect(enrichedMessages).toHaveLength(2)
      expect(enrichedMessages[0].mostRecentRecord?.Status).toBe("With pharmacy")
      expect(enrichedMessages[1].mostRecentRecord).toBeUndefined()
    })
  })
})
