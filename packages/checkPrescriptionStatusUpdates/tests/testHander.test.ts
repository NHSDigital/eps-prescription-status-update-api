import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {handler} from "../src/checkPrescriptionStatusUpdates"
import {mockAPIGatewayProxyEvent, mockContext} from "@PrescriptionStatusUpdate_common/testing"

describe("test handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("respond with empty request and status 404 when no results returned by dynamodb", async () => {
    const mockReply = {
      Count: 0,
      Items: []
    }
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({
      items: []
    })
  })

  it("respond with success when data returned by dynamodb", async () => {
    const mockReply = {
      Count: 1,
      Items: [
        {
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
      ]
    }
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: [
        {
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
      ]
    })
  })

  it("respond with success and LastEvaluatedKey when paginated data returned by dynamodb", async () => {
    const mockReply = {
      Count: 1,
      Items: [
        {
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
      ],
      LastEvaluatedKey: {
        PrescriptionID: "16B2E0-A83008-81C13H",
        TaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11"
      }
    }
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockResolvedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      items: [
        {
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
      ],
      LastEvaluatedKey: {
        PrescriptionID: "16B2E0-A83008-81C13H",
        TaskID: "02f91630-a9c6-4f72-bf54-a64adfac8b11"
      }
    })
  })

  it("respond with failure when dynamodb throws exception", async () => {
    const mockReply = {}
    jest.spyOn(DynamoDBDocumentClient.prototype, "send").mockRejectedValue(mockReply as never)

    const response = await handler(mockAPIGatewayProxyEvent, mockContext)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toMatchObject({
      message: "A system error has occured"
    })
  })
})
