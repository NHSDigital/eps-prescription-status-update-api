/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {BundleEntry} from "fhir/r4"

import {badRequest, conflictDuplicate} from "../src/utils/responses"
import {DEFAULT_DATE, X_REQUEST_ID, mockInternalDependency} from "./utils/testUtils"
import {APIGatewayProxyEvent} from "aws-lambda"

import * as content from "../src/validation/content"
import {handleTransactionCancelledException} from "../src/updatePrescriptionStatus"
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
const mockValidateEntry = mockInternalDependency("../src/validation/content", content, "validateEntry")
const {castEventBody, getXRequestID, validateEntries} = await import("../src/updatePrescriptionStatus")

describe("Unit test getXRequestID", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when event has x-request-id, return it and no response entry", async () => {
    const event: unknown = {headers: {"x-request-id": X_REQUEST_ID}}
    const responseEntries: Array<BundleEntry> = []

    const result = getXRequestID(event as APIGatewayProxyEvent, responseEntries)

    expect(result).toEqual(X_REQUEST_ID)
    expect(responseEntries.length).toEqual(0)
  })

  it.each([
    {
      event: {headers: {"x-request-id": ""}} as unknown,
      scenarioDescription: "when event has empty x-request-id, return undefined and a response entry"
    },
    {
      event: {headers: {}} as unknown,
      scenarioDescription: "when event has a missing x-request-id, return undefined and a response entry"
    }
  ])("$scenarioDescription", async ({event}) => {
    const responseEntries: Array<BundleEntry> = []

    const result = getXRequestID(event as APIGatewayProxyEvent, responseEntries)

    expect(result).toEqual(undefined)
    expect(responseEntries.length).toEqual(1)
    expect(responseEntries[0]).toEqual(badRequest("Missing or empty x-request-id header."))
  })
})

describe("Unit test castEventBody", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when body doesn't have correct resourceType and type, return undefined and a response entry", async () => {
    const body = {resourceType: "NotBundle", type: "not_transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toEqual(undefined)
    expect(responseEntries.length).toEqual(1)
    expect(responseEntries[0]).toEqual(
      badRequest("Request body does not have resourceType of 'Bundle' and type of 'transaction'.")
    )
  })

  it("when body has correct resourceType and type, return bundle and no response entries", async () => {
    const body = {resourceType: "Bundle", type: "transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toBeDefined()
    expect(responseEntries.length).toEqual(0)
  })
})

describe("Unit test validateEntries", () => {
  it("when a single entry is valid, returns true with a response in the response bundle", async () => {
    mockValidateEntry.mockReturnValue({valid: true, issues: undefined})

    const requestEntries = [{resource: {}, fullUrl: "valid"}] as Array<BundleEntry>
    const responseEntries: Array<BundleEntry> = []

    const result = validateEntries(requestEntries, responseEntries)

    expect(result).toEqual(true)
    expect(responseEntries.length).toEqual(1)

    const validResponseEntry = responseEntries[0]
    expect(validResponseEntry.fullUrl).toEqual("valid")
    expect(validResponseEntry.response?.status).toEqual("200 OK")
  })

  it("when one of two entries is invalid, returns false with two responses in the response bundle", async () => {
    mockValidateEntry.mockImplementation((entry: any) => {
      if (entry.fullUrl === "valid") {
        return {valid: true, issues: undefined}
      }
      return {valid: false, issues: "issues"}
    })

    const requestEntries = [
      {resource: {}, fullUrl: "valid"},
      {resource: {}, fullUrl: "invalid"}
    ] as Array<BundleEntry>
    const responseEntries: Array<BundleEntry> = []

    const result = validateEntries(requestEntries, responseEntries)

    expect(result).toEqual(false)
    expect(responseEntries.length).toEqual(2)

    const validResponseEntry = responseEntries[0]
    expect(validResponseEntry.fullUrl).toEqual("valid")
    expect(validResponseEntry.response?.status).toEqual("200 OK")

    const inValidResponseEntry = responseEntries[1]
    expect(inValidResponseEntry.fullUrl).toEqual("invalid")
    expect(inValidResponseEntry.response?.status).toEqual("400 Bad Request")
  })
})

describe("handleTransactionCancelledException", () => {
  beforeAll(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })
  it("should add conflictDuplicate entries to responseEntries", () => {
    const responseEntries: Array<any> = []
    const mockException: TransactionCanceledException = {
      name: "TransactionCanceledException",
      message: "transaction cancelled",
      $fault: "client",
      $metadata: {},
      CancellationReasons: [
        {
          Code: "ConditionalCheckFailed",
          Item: {
            TaskID: {S: "d70678c-81e4-6665-8c67-17596fd0aa46"}
          },
          Message: "The conditional request failed"
        }
      ]
    }

    handleTransactionCancelledException(mockException, responseEntries)

    expect(responseEntries).toHaveLength(1)
    expect(responseEntries[0]).toEqual(conflictDuplicate("d70678c-81e4-6665-8c67-17596fd0aa46"))
  })

  it("should handle missing CancellationReasons gracefully", () => {
    const responseEntries: Array<any> = []
    const mockException: TransactionCanceledException = {
      name: "TransactionCanceledException",
      message: "transaction cancelled",
      $fault: "client",
      $metadata: {}
    }

    handleTransactionCancelledException(mockException, responseEntries)

    expect(responseEntries).toHaveLength(0)
  })
})
