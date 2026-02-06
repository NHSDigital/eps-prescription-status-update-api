import {
  jest,
  describe,
  it,
  expect,
  beforeEach
} from "@jest/globals"
import {QueryCommand, ScanCommand} from "@aws-sdk/lib-dynamodb"
import type {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"

import {NotificationsRepository} from "../src/notificationsRepository"

const mockSend: jest.MockedFunction<(command: QueryCommand | ScanCommand) => Promise<unknown>> = jest.fn()
const mockClient = {send: mockSend} as unknown as DynamoDBDocumentClient

describe("NotificationsRepository", () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it("queries by NHS number when provided", async () => {
    mockSend.mockResolvedValue({
      Items: [{
        NHSNumber: "123",
        RequestId: "req",
        ODSCode: "F1A",
        LastNotificationRequestTimestamp: new Date().toISOString(),
        ExpiryTime: 123,
        LastNotifiedPrescriptionStatus: "DELIVERED",
        NotifyMessageReference: "ref"
      }]
    })

    const repo = new NotificationsRepository(mockClient, "table")
    const results = await repo.fetch({nhsNumber: "123", odsCode: "F1A"})

    expect(results).toHaveLength(1)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const command = mockSend.mock.calls[0][0] as QueryCommand
    expect(command).toBeInstanceOf(QueryCommand)
    expect(command.input.ExpressionAttributeNames?.["#pk"]).toBe("NHSNumber")
    expect(command.input.FilterExpression).toBe("#f0 = :f0")
    expect(command.input.ExpressionAttributeNames?.["#f0"]).toBe("ODSCode")
  })

  it("scans when only non-key filters are supplied", async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          PrescriptionID: "RX1",
          RequestId: "req-1",
          NHSNumber: "999",
          ODSCode: "T1O",
          LastNotificationRequestTimestamp: new Date().toISOString(),
          ExpiryTime: 123,
          LastNotifiedPrescriptionStatus: "REQUESTED",
          NotifyMessageReference: "ref-1"
        }],
        LastEvaluatedKey: {RequestId: "req-1"}
      })
      .mockResolvedValueOnce({
        Items: [{
          PrescriptionID: "RX1",
          RequestId: "req-2",
          NHSNumber: "999",
          ODSCode: "T1O",
          LastNotificationRequestTimestamp: new Date().toISOString(),
          ExpiryTime: 456,
          LastNotifiedPrescriptionStatus: "REQUESTED",
          NotifyMessageReference: "ref-2"
        }]
      })

    const repo = new NotificationsRepository(mockClient, "table")
    const results = await repo.fetch({prescriptionId: "rx1", odsCode: "t1o"})

    expect(results).toHaveLength(2)
    expect(mockSend).toHaveBeenCalledTimes(2)
    const firstCall = mockSend.mock.calls[0][0] as ScanCommand
    expect(firstCall).toBeInstanceOf(ScanCommand)
    expect(firstCall.input.FilterExpression).toBe("#f0 = :f0 AND #f1 = :f1")
    expect(firstCall.input.ExpressionAttributeNames?.["#f0"]).toBe("PrescriptionID")
    expect(firstCall.input.ExpressionAttributeNames?.["#f1"]).toBe("ODSCode")
  })

  it("allows scanning by ODS code only", async () => {
    mockSend.mockResolvedValue({Items: []})

    const repo = new NotificationsRepository(mockClient, "table")
    await repo.fetch({odsCode: "A1B"})

    const call = mockSend.mock.calls[0][0] as ScanCommand
    expect(call).toBeInstanceOf(ScanCommand)
    expect(call.input.FilterExpression).toBe("#f0 = :f0")
    expect(call.input.ExpressionAttributeNames?.["#f0"]).toBe("ODSCode")
  })

  it("throws when no filters are supplied", async () => {
    const repo = new NotificationsRepository(mockClient, "table")

    await expect(repo.fetch({})).rejects.toThrow("At least one filter must be provided")
  })

})
