/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {handler} from "../src/updatePrescriptionStatus"
import {TASK_ID_0, generateMockEvent} from "./utils"
import {ONE_DAY_IN_MS} from "../src/requestContentValidation"

import exampleDispatched from "../../specification/examples/request-dispatched.json"

describe("Unit test for validation via updatePrescriptionStatus handler", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it("when content validation issues are present, should return a 400 status code and 400 response code(s)", async () => {
    const body: any = {...exampleDispatched}

    const now = new Date()
    body.entry[0].resource.lastModified = new Date(now.valueOf() + ONE_DAY_IN_MS + 100000).toISOString()
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const expected = {
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [
        {
          fullUrl: TASK_ID_0,
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

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual(expected)
  })
})
