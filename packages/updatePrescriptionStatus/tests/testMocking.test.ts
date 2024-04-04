/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {BundleEntry} from "fhir/r4"

import * as content from "../src/validation/content"

const mockValidateTask = jest.fn()
jest.unstable_mockModule("../src/validation/content", () => ({
  ...content,
  validateTask: mockValidateTask
}))

const {validateEntries} = await import("../src/updatePrescriptionStatus")

describe("Unit test mocking", () => {
  it("mock the thing", async () => {
    mockValidateTask.mockImplementation(() => ({valid: true, issues: undefined}))

    const requestEntries = [{resource: {id: "hello"}}] as Array<BundleEntry>
    const result = validateEntries(requestEntries, [])

    expect(result).toEqual(true)
  })
})
