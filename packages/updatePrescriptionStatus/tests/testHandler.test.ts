/* eslint-disable @typescript-eslint/no-explicit-any, max-len */
import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {BundleEntry} from "fhir/r4"

import {castEventBody, getXRequestID} from "../src/updatePrescriptionStatus"
import {badRequest} from "../src/utils/responses"
import {DEFAULT_DATE, X_REQUEST_ID} from "./utils/testUtils"
import {APIGatewayProxyEvent} from "aws-lambda"

describe("Unit test getXRequestID", () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("when event has x-request-id, return it and no response in the response bundle", async () => {
    const event: unknown = {headers: {"x-request-id": X_REQUEST_ID}}
    const responseEntries: Array<BundleEntry> = []

    const result = getXRequestID(event as APIGatewayProxyEvent, responseEntries)

    expect(result).toEqual(X_REQUEST_ID)
    expect(responseEntries.length).toEqual(0)
  })

  it.each([
    {
      event: {headers: {"x-request-id": ""}} as unknown,
      scenarioDescription: "when event has empty x-request-id, return undefined and a response in the response bundle"
    },
    {
      event: {headers: {}} as unknown,
      scenarioDescription: "when event has a missing x-request-id, return undefined and a response in the response bundle"
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

  it("when body doesn't have correct resourceType and type, return undefined and a response in the response bundle", async () => {
    const body = {resourceType: "NotBundle", type: "not_transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toEqual(undefined)
    expect(responseEntries.length).toEqual(1)
    expect(responseEntries[0]).toEqual(badRequest("Request body does not have resourceType of 'Bundle' and type of 'transaction'."))
  })

  it("when body has correct resourceType and type, return bundle and no response in the response bundle", async () => {
    const body = {resourceType: "Bundle", type: "transaction"}
    const responseEntries: Array<BundleEntry> = []

    const result = castEventBody(body, responseEntries)

    expect(result).toBeDefined()
    expect(responseEntries.length).toEqual(0)
  })
})
