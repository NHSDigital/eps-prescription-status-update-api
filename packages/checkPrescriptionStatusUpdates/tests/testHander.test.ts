import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {handler} from "../src/checkPrescriptionStatusUpdates"
import {mockAPIGatewayProxyEvent, mockContext} from "@PrescriptionStatusUpdate_common/testing"

const defaultItem = {
  ApplicationName: "unknown",
  RequestID: "3e5e9c15-4bc5-4118-a388-00d8eea459ed",
  LastModified: "2023-10-11T10:11:12Z",
  TerminalStatus: "completed",
  PharmacyODSCode: "C9Z1O",
  Status: "dispatched",
  TaskID: "01a7e55a-7b90-4be7-9b67-e19b6d061bdd",
  PatientNHSNumber: "9449304130",
  LineItemID: "6989b7bd-8db6-428c-a593-4022e3044c00",
  PrescriptionID: "16B2E0-A83008-81C13H"
}

describe("test handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("respond with empty request and status 404 when no results returned by dynamodb", async () => {
    const mockReply = generate_reply(0)
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({
      items: []
    })
  })

  it("respond with success when data returned by dynamodb", async () => {
    const mockReply = generate_reply(1)
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: [defaultItem]
    })
  })

  it("respond with success and LastEvaluatedKey when paginated data returned by dynamodb", async () => {
    const mockReply = generate_reply(5, false)
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: Array(5).fill(defaultItem)
    })

    expect(response.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "LastEvaluatedKey-PrescriptionID": "16B2E0-A83008-81C13H",
      "LastEvaluatedKey-TaskID": "02f91630-a9c6-4f72-bf54-a64adfac8b11"
    })
  })

  it("returns less than 5 results if that's all that's available", async () => {
    const mockReply = generate_reply(3)
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: Array(3).fill(defaultItem)
    })

    expect(response.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    })
  })

  it("returns just more than 5 results", async () => {
    // 6 results in 2 calls, expecting 6 results
    jest
      .spyOn(DynamoDBDocumentClient.prototype, "send")
      .mockImplementationOnce(() => {
        return Promise.resolve(generate_reply(3, false))
      })
      .mockImplementationOnce(() => {
        return Promise.resolve(generate_reply(3))
      })

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: Array(6).fill(defaultItem)
    })

    expect(response.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    })
  })

  it("returns just more than 5 results with pagination headers", async () => {
    jest
      .spyOn(DynamoDBDocumentClient.prototype, "send")
      .mockImplementationOnce(() => {
        const reply = generate_reply(2, false)
        reply.LastEvaluatedKey = {
          PrescriptionID: "prescriptionId2",
          TaskID: "taskId2"
        }
        return Promise.resolve(reply)
      })
      .mockImplementationOnce(() => {
        const reply = generate_reply(2, false)
        reply.LastEvaluatedKey = {
          PrescriptionID: "prescriptionId3",
          TaskID: "taskId3"
        }
        return Promise.resolve(reply)
      })
      .mockImplementationOnce(() => {
        return Promise.resolve(generate_reply(2))
      })
    const mockSend = DynamoDBDocumentClient.prototype.send as jest.Mock

    const event = JSON.parse(JSON.stringify(mockAPIGatewayProxyEvent))
    event.headers["exclusivestartkey-prescriptionid"] = "prescriptionId1"
    event.headers["exclusivestartkey-taskid"] = "taskId1"

    const response = await handler(event, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: Array(6).fill(defaultItem)
    })
    expect(response.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    })

    const startKeys = mockSend.mock.calls.map((call) => call[0]["input"]["ExclusiveStartKey"])
    const prescriptionIDs = startKeys.map((key) => key["PrescriptionID"])
    const taskIDs = startKeys.map((key) => key["TaskID"])
    expect(prescriptionIDs).toEqual(["prescriptionId1", "prescriptionId2", "prescriptionId3"])
    expect(taskIDs).toEqual(["taskId1", "taskId2", "taskId3"])
  })

  it("returns no more than 15 results", async () => {
    // >15 results (15 with pagination headers), expecting 15 results
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementationOnce(() => {
      return Promise.resolve(generate_reply(15, false))
    })

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: Array(15).fill(defaultItem)
    })

    expect(response.headers).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "LastEvaluatedKey-PrescriptionID": "16B2E0-A83008-81C13H",
      "LastEvaluatedKey-TaskID": "02f91630-a9c6-4f72-bf54-a64adfac8b11"
    })
  })

  it("respond with failure when dynamodb throws exception", async () => {
    const mockReply = {}
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockRejectedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toMatchObject({
      message: "A system error has occurred"
    })
  })
})

function generate_reply(count, final = true) {
  const reply = {
    Count: count,
    Items: Array(count).fill(defaultItem),
    LastEvaluatedKey: {
      PrescriptionID: "16B2E0-A83008-81C13H",
      TaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11"
    }
  }

  if (final) {
    delete reply.LastEvaluatedKey
  }

  return reply
}
