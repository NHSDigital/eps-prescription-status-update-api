/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {Task} from "fhir/r4"

import {
  lastModified,
  nhsNumber,
  ONE_DAY_IN_MS,
  prescriptionID,
  status,
  transactionBundle,
  validateTask,
  ValidationOutcome
} from "../src/validation/content"

import valid from "./tasks/valid.json"
import {generateInvalidNhsNumbers} from "./utils/nhsNumber"
import {DEFAULT_DATE} from "./utils/testUtils"
import {fields} from "../src/validation/fields"

describe("Unit test for overall task validation", () => {
  it("When task is valid, should return true with no issues.", async () => {
    const expectedOutcome = {valid: true, issues: undefined}
    const actual: ValidationOutcome = validateTask(valid as Task)
    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit tests for pre-cast validation of bundle", () => {
  it("When resourceType is not Bundle, should return expected issue.", async () => {
    const body = {resourceType: "NotBundle"}

    const actual = transactionBundle(body)

    expect(actual).toEqual(false)
  })

  it("When type is not transaction, should return expected issue.", async () => {
    const body = {type: "not_transaction"}

    const actual = transactionBundle(body)

    expect(actual).toEqual(false)
  })
})

describe("Unit tests for validation of lastModified", () => {
  it("When lastModified is over a day in the future, should return expected issue.", async () => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE.valueOf() - (ONE_DAY_IN_MS + 1000))
    const task = {...valid}

    const expected = "Invalid last modified value provided."

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
      expected: "Completed state indicated for a prescription status requiring patient action."
    },
    {
      taskStatus: "completed",
      businessStatus: "Ready to collect",
      expected: "Completed state indicated for a prescription status requiring patient action."
    },
    {
      taskStatus: "completed",
      businessStatus: "ReAdY tO cOlLeCt",
      expected: "Completed state indicated for a prescription status requiring patient action."
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

describe("Unit tests for validation of fields", () => {
  it.each([
    {
      missingField: "PatientNHSNumber",
      operation: ((t: Task) => delete t.for)
    },
    {
      missingField: "TaskID",
      operation: ((t: Task) => delete t.id)
    },
    {
      missingField: "PrescriptionID",
      operation: ((t: Task) => delete t.basedOn)
    }
  ])("When $missingField is missing, should return expected issue.", async ({operation, missingField}) => {
    const task = {...valid} as any
    operation(task)

    const expected = `Missing required fields - ${missingField}.`

    const actual = fields(task as Task)

    expect(actual).toEqual(expected)
  })
})
