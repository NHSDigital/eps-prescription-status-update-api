/* eslint-disable @typescript-eslint/no-explicit-any */
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {handler} from "../src/updatePrescriptionStatus"
import {helloworldContext} from "./helloworldContext"
import {mockAPIGatewayProxyEvent} from "./mockAPIGatewayProxyEvent"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"

describe("updatePrescriptionStatus Lambda Handler", () => {
  const dummyContext = helloworldContext
  const expectedItem = {
    LineItemID: {"S": "LineItemID"},
    PatientNHSNumber: {"S": "PatientNHSNumber"},
    PharmacyODSCode: {"S": "PharmacyODSCode"},
    PrescriptionID: {"S": "PrescriptionID"},
    RequestID: {"S": "test-request-id"},
    TaskID: {"S": "TaskID"},
    TerminalStatus: {"S": "TerminalStatus"},
    RequestMessage: expect.any(Object)
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("should successfully update a single item into DynamoDB", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID"}}],
              for: {identifier: {value: "PatientNHSNumber"}},
              owner: {identifier: {value: "PharmacyODSCode"}},
              id: "TaskID",
              focus: {identifier: {value: "LineItemID"}},
              status: "TerminalStatus"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, dummyContext)

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining(expectedItem)
        })
      })
    )
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseSingleItem)
  })

  it("should successfully update multiple items into DynamoDB", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID1"}}],
              for: {identifier: {value: "PatientNHSNumber1"}},
              owner: {identifier: {value: "PharmacyODSCode1"}},
              id: "TaskID1",
              focus: {identifier: {value: "LineItemID1"}},
              status: "TerminalStatus1"
            }
          },
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID2"}}],
              for: {identifier: {value: "PatientNHSNumber2"}},
              owner: {identifier: {value: "PharmacyODSCode2"}},
              id: "TaskID2",
              focus: {identifier: {value: "LineItemID2"}},
              status: "TerminalStatus2"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, dummyContext)

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(2)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseMultipleItems)
  })

  it("should handle errors with a 500 status code and internal server error message", async () => {
    const event: APIGatewayProxyEvent = {
      ...mockAPIGatewayProxyEvent,
      body: JSON.stringify({
        entry: [
          {
            resource: {
              basedOn: [{identifier: {value: "PrescriptionID"}}],
              for: {identifier: {value: "PatientNHSNumber"}},
              owner: {identifier: {value: "PharmacyODSCode"}},
              id: "TaskID",
              focus: {identifier: {value: "LineItemID"}},
              status: "TerminalStatus"
            }
          }
        ]
      })
    }

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const result: APIGatewayProxyResult = await handler(event, {} as any)

    expect(result.statusCode).toEqual(500)
    expect(JSON.parse(result.body)).toEqual({
      resourceType: "OperationOutcome",
      issue: [
        {
          code: "exception",
          severity: "fatal",
          details: {
            coding: [
              {
                system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                code: "SERVER_ERROR",
                display: "500: The Server has encountered an error processing the request."
              }
            ]
          }
        }
      ]
    })
  })
})
