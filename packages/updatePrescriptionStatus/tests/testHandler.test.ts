/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {handler} from "../src/updatePrescriptionStatus"
import exampleDispatched from "../../specification/examples/request-dispatched.json"
import exampleMultipleItems from "../../specification/examples/request-multiple-items.json"
import exampleMissingFields from "../../specification/examples/request-missing-fields.json"
import exampleNoItems from "../../specification/examples/request-no-items.json"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import responseMultipleItems from "../../specification/examples/response-multiple-items.json"
import {generateExpectedItem, generateMockEvent} from "./utils"

describe("Unit test for updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it("should successfully update a single item into DynamoDB", async () => {
    const body = {
      entry: [
        {
          resource: {
            basedOn: [{identifier: {value: "PrescriptionID"}}],
            for: {identifier: {value: "PatientNHSNumber"}},
            owner: {identifier: {value: "PharmacyODSCode"}},
            id: "TaskID",
            focus: {identifier: {value: "LineItemID"}},
            status: "TerminalStatus",
            lastModified: "2023-09-11T10:11:12Z"
          }
        }
      ]
    }
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, {})

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining(
            generateExpectedItem(
              "LineItemID",
              "PatientNHSNumber",
              "PharmacyODSCode",
              "PrescriptionID",
              "TaskID",
              "TerminalStatus",
              "2023-09-11T10:11:12Z"
            )
          )
        })
      })
    )
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(1)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseSingleItem)
  })

  it("should successfully update multiple items into DynamoDB", async () => {
    const body = {
      entry: [
        {
          resource: {
            basedOn: [{identifier: {value: "PrescriptionID1"}}],
            for: {identifier: {value: "PatientNHSNumber1"}},
            owner: {identifier: {value: "PharmacyODSCode1"}},
            id: "TaskID1",
            focus: {identifier: {value: "LineItemID1"}},
            status: "TerminalStatus1",
            lastModified: "2023-09-11T10:11:12Z"
          }
        },
        {
          resource: {
            basedOn: [{identifier: {value: "PrescriptionID2"}}],
            for: {identifier: {value: "PatientNHSNumber2"}},
            owner: {identifier: {value: "PharmacyODSCode2"}},
            id: "TaskID2",
            focus: {identifier: {value: "LineItemID2"}},
            status: "TerminalStatus2",
            lastModified: "2023-09-11T10:11:12Z"
          }
        }
      ]
    }
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue(undefined as never)

    const result: APIGatewayProxyResult = await handler(event, {})

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledTimes(2)
    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual(responseMultipleItems)
    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining(
            generateExpectedItem(
              "LineItemID1",
              "PatientNHSNumber1",
              "PharmacyODSCode1",
              "PrescriptionID1",
              "TaskID1",
              "TerminalStatus1",
              "2023-09-11T10:11:12Z"
            )
          )
        })
      })
    )

    expect(DynamoDBClient.prototype.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining(
            generateExpectedItem(
              "LineItemID2",
              "PatientNHSNumber2",
              "PharmacyODSCode2",
              "PrescriptionID2",
              "TaskID2",
              "TerminalStatus2",
              "2023-09-11T10:11:12Z"
            )
          )
        })
      })
    )
  })

  it.each([
    {
      example: exampleDispatched,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for a single item"
    },
    {
      example: exampleMultipleItems,
      httpResponseCode: 201,
      scenarioDescription: "201 with response bundle for multiple items"
    },
    {
      example: exampleNoItems,
      httpResponseCode: 200,
      scenarioDescription: "200 status code if there are no entries to process"
    }
  ])(
    "should return $scenarioDescription",
    async ({example, httpResponseCode}) => {
      const event: APIGatewayProxyEvent = generateMockEvent(example)
      const response: APIGatewayProxyResult = await handler(event, {})

      expect(response.statusCode).toBe(httpResponseCode)
      const responseBody = JSON.parse(response.body!)
      expect(responseBody).toHaveProperty("resourceType", "Bundle")
      expect(responseBody).toHaveProperty("type", "transaction-response")
    })

  it("should return a 400 status code and error message when provided with invalid JSON", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleDispatched)
    event.body = '{ "resourceType": "Bundle",  "type": "transaction", "entry":}'
    const response: APIGatewayProxyResult = await handler(event, {})
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        {
          response: {
            status: "400 Bad Request",
            outcome: {
              resourceType: "OperationOutcome",
              issue: [
                {
                  code: "value",
                  severity: "error",
                  details: {
                    coding: [
                      {
                        system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                        code: "BAD_REQUEST",
                        display: "400: The Server was unable to process the request."
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    })
  })

  it("should return a 201 status code, 400 response code and error message indicating missing required fields", async () => {
    const event: APIGatewayProxyEvent = generateMockEvent(exampleMissingFields)
    const response: APIGatewayProxyResult = await handler(event, {})
    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body!)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        {
          response: {
            status: "400 Bad Request",
            location: "Task/4d70678c-81e4-4ff4-8c67-17596fd0aa46/_history/1",
            outcome: {
              resourceType: "OperationOutcome",
              issue: [
                {
                  code: "value",
                  severity: "error",
                  details: {
                    coding: [
                      {
                        system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                        code: "BAD_REQUEST",
                        display: "400: Missing required fields: PrescriptionID, PatientNHSNumber"
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    })
  })

  it("should handle errors with a 201 status code, 500 response code and internal server error message", async () => {
    const body = {
      entry: [
        {
          resource: {
            basedOn: [{identifier: {value: "PrescriptionID"}}],
            for: {identifier: {value: "PatientNHSNumber"}},
            owner: {identifier: {value: "PharmacyODSCode"}},
            id: "TaskID",
            focus: {identifier: {value: "LineItemID"}},
            status: "TerminalStatus",
            lastModified: "2023-09-11T10:11:12Z"
          }
        }
      ]
    }
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const result: APIGatewayProxyResult = await handler(event, {})

    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        {
          response: {
            status: "500 Internal Server Error",
            location: "Task/TaskID/_history/1",
            outcome: {
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
            }
          }
        }
      ]
    })
  })

  it("should handle multiple errors with a 201 status code, appropriate response codes and error messages", async () => {
    const body: any = {...exampleMissingFields}
    body.entry.push({
      resource: {
        basedOn: [{identifier: {value: "PrescriptionID"}}],
        for: {identifier: {value: "PatientNHSNumber"}},
        owner: {identifier: {value: "PharmacyODSCode"}},
        id: "0ae4daf3-f24b-479d-b8fa-b69e2d873b60",
        focus: {identifier: {value: "LineItemID"}},
        status: "TerminalStatus",
        lastModified: "2023-09-11T10:11:12Z"
      }
    })
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    jest.spyOn(DynamoDBClient.prototype, "send").mockRejectedValue(new Error("Mocked error") as never)

    const result: APIGatewayProxyResult = await handler(event, {})

    expect(result.statusCode).toEqual(201)
    expect(JSON.parse(result.body)).toEqual({
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        {
          response: {
            status: "400 Bad Request",
            location: "Task/4d70678c-81e4-4ff4-8c67-17596fd0aa46/_history/1",
            outcome: {
              resourceType: "OperationOutcome",
              issue: [
                {
                  code: "value",
                  severity: "error",
                  details: {
                    coding: [
                      {
                        system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                        code: "BAD_REQUEST",
                        display: "400: Missing required fields: PrescriptionID, PatientNHSNumber"
                      }
                    ]
                  }
                }
              ]
            }
          }
        },
        {
          response: {
            status: "500 Internal Server Error",
            location: "Task/0ae4daf3-f24b-479d-b8fa-b69e2d873b60/_history/1",
            outcome: {
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
            }
          }
        }
      ]
    })
  })

  it("should return 500 status code and internal server error message if an error occurs", async () => {
    const event = {}
    const response: APIGatewayProxyResult = await handler(event, undefined)
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({
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
