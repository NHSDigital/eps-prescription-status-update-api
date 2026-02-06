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
  getExistingRecordsByPrescriptionID,
  fetchExistingRecordsForPrescriptions,
  enrichMessagesWithExistingRecords
} = await import("../src/databaseClient")

const logger = new Logger({serviceName: "postDatedLambdaTEST"})

describe("databaseClient", () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  describe("getExistingRecordsByPrescriptionID", () => {
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

      const records = await getExistingRecordsByPrescriptionID(
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

      const records = await getExistingRecordsByPrescriptionID(prescriptionID, logger)

      expect(records).toEqual([])
    })

    it("Should log and throw an error if the DynamoDB query fails", async () => {
      const prescriptionID = "errorPrescID"

      // Mock DynamoDB to throw an error
      const mockError = new Error("DynamoDB query failed")
      mockSend.mockImplementationOnce(() => {
        throw mockError
      })

      await expect(
        getExistingRecordsByPrescriptionID(
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

      const records = await getExistingRecordsByPrescriptionID(prescriptionID, logger)

      expect(mockSend).toHaveBeenCalledTimes(2)
      expect(records).toHaveLength(2)
      expect(records[0].Status).toBe("Ready to collect")
      expect(records[1].Status).toBe("With pharmacy")
    })
  })

  describe("fetchExistingRecordsForPrescriptions", () => {
    it("should fetch existing records for multiple prescriptions", async () => {
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

      const result = await fetchExistingRecordsForPrescriptions(
        prescriptions,
        logger
      )

      expect(result.length).toBe(2)
      expect(result[0].existingRecords.length).toBe(1)
      expect(result[0].existingRecords[0].Status).toBe("With pharmacy")
      expect(result[1].existingRecords.length).toBe(1)
      expect(result[1].existingRecords[0].Status).toBe("Ready to collect")
    })

    it(
      "Should log an error if the fetch fails for one prescription, and set the existingRecords to empty array",
      async () => {
        const prescriptions = [
          createMockPostModifiedDataItem({PrescriptionID: "presc1", PharmacyODSCode: "pharmA"}),
          createMockPostModifiedDataItem({PrescriptionID: "errorPresc", PharmacyODSCode: "errorPharm"})
        ]

        // Mock DynamoDB responses
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
          .mockImplementationOnce(() => {
            throw new Error("DynamoDB query failed")
          })

        const result = await fetchExistingRecordsForPrescriptions(
          prescriptions,
          logger
        )

        expect(result.length).toBe(2)
        expect(result[0].existingRecords.length).toBe(1)
        expect(result[0].existingRecords[0].Status).toBe("With pharmacy")
        expect(result[1].existingRecords.length).toBe(0)
      })

    it("should return prescriptions with empty existingRecords when DynamoDB has no matches", async () => {
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

      const result = await fetchExistingRecordsForPrescriptions(prescriptions, logger)

      expect(result).toHaveLength(2)
      expect(result[0].existingRecords).toEqual([])
      expect(result[1].existingRecords).toEqual([])
    })
  })

  describe("enrichMessagesWithExistingRecords", () => {
    it("should enrich messages with existing records", async () => {
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

      const enrichedMessages = await enrichMessagesWithExistingRecords(
        messages,
        logger
      )

      expect(enrichedMessages.length).toBe(2)
      expect(enrichedMessages[0].existingRecords.length).toBe(1)
      expect(enrichedMessages[0].existingRecords[0].Status).toBe("With pharmacy")
      expect(enrichedMessages[1].existingRecords.length).toBe(1)
      expect(enrichedMessages[1].existingRecords[0].Status).toBe("Ready to collect")
    })

    it("should return an empty array when no messages are provided", async () => {
      const enrichedMessages = await enrichMessagesWithExistingRecords([], logger)

      expect(enrichedMessages).toEqual([])
    })
  })
})
