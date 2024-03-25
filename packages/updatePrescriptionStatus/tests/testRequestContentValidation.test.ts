/* eslint-disable @typescript-eslint/no-explicit-any */

import {expect, describe, it} from "@jest/globals"
import {Task} from "fhir/r4"

import {
  lastModified,
  nhsNumber,
  ONE_DAY_IN_MS,
  prescriptionID,
  status,
  validateTask,
  ValidationOutcome
} from "../src/requestContentValidation"

import valid from "./tasks/valid.json"
import {generateInvalidNhsNumbers} from "./utils/nhsNumber"

describe("Unit tests for overall task validation", () => {
  it.each([
    {
      task: valid,
      expectedOutcome: {valid: true, issues: undefined},
      scenarioDescription: "When task is valid, should return true with no issues."
    }
  ])(
    "should return $scenarioDescription",
    async ({task, expectedOutcome}) => {
      const actual: ValidationOutcome = validateTask(task as Task)
      expect(actual).toEqual(expectedOutcome)
    })
})

describe("Unit tests for validation of lastModified", () => {
  it("When lastModified is over a day in the future, should return expected issue.", async () => {
    const today = new Date()
    const future = new Date(today.valueOf() + ONE_DAY_IN_MS + 1000)
    const task = {...valid}
    task.lastModified = future.toISOString()

    const expected = "Date provided for lastModified is more than one day in the future."

    const actual = lastModified(task as Task)

    expect(actual).toEqual(expected)
  })

  it("When last modified date format is invalid, should return expected issue.", async () => {
    const task = {...valid}
    task.lastModified = "invalid date"

    const expected = "Date format provided for lastModified is invalid."

    const actual = lastModified(task as Task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of prescription ID", () => {
  it("When prescription ID is invalid, should return expected issue.", async () => {
    const task = {...valid}
    task.basedOn[0].identifier.value = "invalid"

    const expected = "Prescription ID is invalid."

    const actual = prescriptionID(task as Task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of NHS number", () => {
  it("When NHS number is invalid, should return expected issue.", async () => {
    const task = {...valid}
    task.for.identifier.value = generateInvalidNhsNumbers(1)[0]

    const expected = "NHS number is invalid."

    const actual = nhsNumber(task as Task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of status against business status", () => {
  it.each([
    {
      taskStatus: "completed",
      businessStatus: "With Pharmacy",
      expected: "Status cannot be 'completed' when business status is 'With Pharmacy'."
    },
    {
      taskStatus: "completed",
      businessStatus: "Ready to collect",
      expected: "Status cannot be 'completed' when business status is 'Ready to collect'."
    },
    {
      taskStatus: "completed",
      businessStatus: "ReAdY tO cOlLeCt",
      expected: "Status cannot be 'completed' when business status is 'ReAdY tO cOlLeCt'."
    },
    {
      taskStatus: "in-progress",
      businessStatus: "With Pharmacy",
      expected: undefined
    },
    {
      taskStatus: "in-progress",
      businessStatus: "Ready to collect",
      expected: undefined
    }
  ])(
    "When status is '$status' and business status is '$businessStatus', should return expected issue.",
    async ({taskStatus, businessStatus, expected}) => {
      const task = {...valid}
      task.status = taskStatus
      task.businessStatus.coding[0].code = businessStatus

      const actual = status(task as Task)

      expect(actual).toEqual(expected)
    }
  )
})
