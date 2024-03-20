/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {handler} from "../src/updatePrescriptionStatus"
import exampleDispatched from "../../specification/examples/request-dispatched.json"
import {generateMockEvent} from "./utils"
import {ONE_DAY_IN_MS} from "../src/requestContentValidation"

describe("Unit test for validation via updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("should return a 201 status code and 400 response codes when content validation issues are present", async () => {
    const body: any = {...exampleDispatched}

    const now = new Date()
    body.entry[0].resource.lastModified = new Date(now.valueOf() + ONE_DAY_IN_MS + 100000).toISOString()
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = {
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
                        display: "Validation issues: Date provided for lastModified is more than one day in the future."
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      ]
    }

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toBe(201)
    expect(JSON.parse(response.body!)).toEqual(expected)
  })
})
