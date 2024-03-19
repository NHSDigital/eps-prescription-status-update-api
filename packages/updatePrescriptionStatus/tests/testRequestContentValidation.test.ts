/* eslint-disable @typescript-eslint/no-explicit-any */
import exampleValid from "../../specification/examples/contentValidation/request-valid.json"
import {expect, describe, it} from "@jest/globals"
import {
  Issue,
  ONE_DAY_IN_MS,
  lastModified,
  validate
} from "../src/requestContentValidation"
import {Bundle} from "fhir/r4"

describe("Unit tests for overall request content validation", () => {
  it.each([
    {
      request: exampleValid,
      expectedIssues: [],
      scenarioDescription: "Valid request body"
    }
  ])(
    "should return $scenarioDescription",
    async ({request, expectedIssues}) => {
      const issues: Array<Issue> = validate(request as Bundle)

      expect(issues).toEqual(expectedIssues)
    })
})

describe("Unit tests for validation of lastModified", () => {
  it("over a day in the future", async () => {
    const today = new Date()
    const future = new Date(today.valueOf() + ONE_DAY_IN_MS + 1000)
    const bundle = {...exampleValid}
    bundle.entry[0].resource.lastModified = future.toISOString()

    const expectedIssue: Array<Issue> = [{
      fhirPath: "entry[0].resource.lastModified",
      description: "Date provided for lastModified is more than one day in the future."
    }]

    const issue = lastModified(bundle as Bundle)
    expect(issue).toEqual(expectedIssue)
  })

  it("invalid date format", async () => {
    const bundle = {...exampleValid}
    bundle.entry[0].resource.lastModified = "invalid date"

    const expectedIssue: Array<Issue> = [{
      fhirPath: "entry[0].resource.lastModified",
      description: "Date format provided for lastModified is invalid."
    }]

    const issue = lastModified(bundle as Bundle)
    expect(issue).toEqual(expectedIssue)
  })

  it("both issues present", async () => {
    const today = new Date()
    const future = new Date(today.valueOf() + ONE_DAY_IN_MS + 1000)
    const bundle = {...exampleValid}
    bundle.entry[0].resource.lastModified = future.toISOString()
    bundle.entry[1].resource.lastModified = "invalid date"

    const expectedIssue: Array<Issue> = [
      {
        fhirPath: "entry[0].resource.lastModified",
        description: "Date provided for lastModified is more than one day in the future."
      },
      {
        fhirPath: "entry[1].resource.lastModified",
        description: "Date format provided for lastModified is invalid."
      }
    ]

    const issue = lastModified(bundle as Bundle)
    expect(issue).toEqual(expectedIssue)
  })
})
