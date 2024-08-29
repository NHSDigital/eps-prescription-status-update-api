/* eslint-disable  max-len */

import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {
  lastModified,
  nhsNumber,
  ONE_DAY_IN_MS,
  prescriptionID,
  taskStatusAgainstBusinessStatus,
  taskContent,
  validateEntry,
  ValidationOutcome,
  entryContent,
  nhsNumberRange
} from "../../src/validation/content"

import {generateInvalidNhsNumbers, generateValidNhsNumbers} from "../utils/nhsNumber"
import {
  DEFAULT_DATE,
  FULL_URL_0,
  validRequest,
  validTask
} from "../utils/testUtils"
import {taskType} from "../../src/schema/request"

describe("Unit test for overall task validation", () => {
  it("When task is valid, should return true with no issues.", async () => {
    const expectedOutcome: ValidationOutcome = {valid: true, issues: []}
    const entry = {fullUrl: FULL_URL_0, resource: validTask(), request: validRequest()}

    const actual = validateEntry(entry)

    expect(actual).toEqual(expectedOutcome)
  })

  it("When task is invalid in multiple ways, should return false with issues.", async () => {
    const task = validTask()
    task.for.identifier.value = "invalidNhsNumber"
    task.lastModified = "invalidDate"
    const entry = {fullUrl: FULL_URL_0, resource: task, request: validRequest()}

    const expectedOutcome = {
      valid: false,
      issues: [
        "Date format provided for lastModified is invalid.",
        "NHS number is invalid.",
        "NHS number is not in a known, valid range."
      ]
    }

    const actual: ValidationOutcome = validateEntry(entry)

    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit test for taskContent", () => {
  it("When task is valid, should return empty array.", async () => {
    const task = validTask()
    const actual = taskContent(task)

    expect(actual).toEqual([])
  })

  it("When task is invalid in multiple ways, should return array with all issues.", async () => {
    const task = validTask()
    task.for.identifier.value = "invalidNhsNumber"
    task.lastModified = "invalidDate"

    const actual = taskContent(task)

    expect(actual).toEqual([
      "Date format provided for lastModified is invalid.",
      "NHS number is invalid.",
      "NHS number is not in a known, valid range."
    ])
  })
})

describe("Unit test for entryContent", () => {
  it("When entry is valid, should return empty array.", async () => {
    const entry = {fullUrl: FULL_URL_0, resource: validTask(), request: validRequest()}
    const actual: Array<string> = entryContent(entry)

    expect(actual).toEqual([])
  })

  it("When entry is invalid, should return array with issue.", async () => {
    const entry = {fullUrl: FULL_URL_0, resource: validTask(), request: validRequest()}
    entry.fullUrl = "invalid"
    const actual: Array<string> = entryContent(entry)

    expect(actual).toEqual(["Entry fullUrl does not match task id."])
  })
})

describe("Unit tests for validation of lastModified", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("When lastModified is over a day in the future, should return expected issue.", async () => {
    const futureDate = new Date(DEFAULT_DATE.valueOf() + (ONE_DAY_IN_MS + 1000))
    const task = validTask()
    task.lastModified = futureDate.toISOString()

    const actual = lastModified(task)

    expect(actual).toEqual("Last modified value was more than one day in the future.")
  })

  it("When last modified date format is invalid, should return expected issue.", async () => {
    const task = validTask()
    task.lastModified = "invalid date"

    const actual = lastModified(task)

    expect(actual).toEqual("Date format provided for lastModified is invalid.")
  })

  it("When lastModified is valid and not in the future, should return undefined.", async () => {
    const task = validTask()
    task.lastModified = DEFAULT_DATE.toISOString()

    const actual = lastModified(task)

    expect(actual).toEqual(undefined)
  })
})

describe("Unit tests for validation of prescription ID", () => {
  it.each([
    {
      testPrescriptionID: "invalid",
      expected: "Prescription ID is invalid.",
      scenarioDescription: "When prescription ID is invalid, should return expected issue."
    },
    {
      testPrescriptionID: "07A66F-A83008-1EEEA0",
      expected: undefined,
      scenarioDescription: "When prescription ID is valid, should return undefined."
    }
  ])("$scenarioDescription", async ({testPrescriptionID, expected}) => {
    const task = validTask()
    task.basedOn[0].identifier.value = testPrescriptionID

    const actual = prescriptionID(task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of NHS number", () => {
  it.each([
    {
      generatedNhsNumber: generateInvalidNhsNumbers(1)[0],
      expected: "NHS number is invalid.",
      scenarioDescription: "When NHS number is invalid, should return expected issue."
    },
    {
      generatedNhsNumber: generateValidNhsNumbers(1)[0],
      expected: undefined,
      scenarioDescription: "When NHS number is valid, should return undefined."
    }
  ])("$scenarioDescription", async ({generatedNhsNumber, expected}) => {
    const task = validTask()
    task.for.identifier.value = generatedNhsNumber

    const actual = nhsNumber(task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of NHS number range", () => {
  it.each([
    {
      nhsNumbers: ["0101000000", "3112999999"],
      expected: "NHS number is in the Scottish range.",
      scenarioDescription: "When NHS number is in the Scottish range, should return expected issue."
    },
    {
      nhsNumbers: ["3200000001", "3999999999"],
      expected: "NHS number is in the Northern Irish range.",
      scenarioDescription: "When NHS number is in the Northern Irish range, should return expected issue."
    },
    {
      nhsNumbers: [
        "3113000000",
        "3200000000",
        "4000000000",
        "4999999999",
        "6000000000",
        "7999999999",
        "9000000000",
        "9999999999"
      ],
      expected: undefined,
      scenarioDescription: "When NHS number is in the NHSE range."
    }
  ])("$scenarioDescription", async ({nhsNumbers, expected}) => {
    for (const nhsNumber of nhsNumbers) {
      const task = validTask()
      task.for.identifier.value = nhsNumber

      const actual = nhsNumberRange(task)

      expect(actual).toEqual(expected)
    }
  })
})

describe("Unit tests for validation of status against business status", () => {
  type BusinessStatusTestCase = {
    isValid: boolean
    businessStatus: taskType["businessStatus"]["coding"][0]["code"]
  }
  describe("When task status is 'completed'", () => {
    it.each<BusinessStatusTestCase>([
      {isValid: false, businessStatus: "With Pharmacy"},
      {isValid: false, businessStatus: "With Pharmacy - Preparing Remainder"},
      {isValid: false, businessStatus: "Ready to Collect - Partial"},
      {isValid: true, businessStatus: "Ready to Collect"},
      {isValid: true, businessStatus: "Collected"},
      {isValid: true, businessStatus: "Not Dispensed"},
      {isValid: true, businessStatus: "Dispatched"},
      {isValid: true, businessStatus: "Ready to Dispatch"},
      {isValid: false, businessStatus: "Ready to Dispatch - Partial"}
    ])(
      "When status is 'completed' and business status is '$businessStatus', should return expected issue.",
      ({isValid, businessStatus}) => {
        const task = validTask()
        task.status = "completed"
        task.businessStatus.coding[0].code = businessStatus
        const actual = taskStatusAgainstBusinessStatus(task)
        const expected = isValid
          ? undefined
          : `Task.status field set to 'completed' but Task.businessStatus value of '${businessStatus}' requires follow up action.`
        expect(actual).toEqual(expected)
      }
    )
  })

  describe("When task status is 'in-progress'", () => {
    it.each<BusinessStatusTestCase>([
      {isValid: true, businessStatus: "With Pharmacy"},
      {isValid: true, businessStatus: "With Pharmacy - Preparing Remainder"},
      {isValid: true, businessStatus: "Ready to Collect"},
      {isValid: true, businessStatus: "Ready to Collect - Partial"},
      {isValid: true, businessStatus: "Ready to Dispatch"},
      {isValid: true, businessStatus: "Ready to Dispatch - Partial"},
      {isValid: false, businessStatus: "Collected"},
      {isValid: false, businessStatus: "Not Dispensed"},
      {isValid: false, businessStatus: "Dispatched"}
    ])(
      "When status is 'in-progress' and business status is '$businessStatus', should return expected issue.",
      ({isValid, businessStatus}) => {
        const task = validTask()
        task.status = "in-progress"
        task.businessStatus.coding[0].code = businessStatus
        const actual = taskStatusAgainstBusinessStatus(task)
        const expected = isValid
          ? undefined
          : `Task.status field set to 'in-progress' but Task.businessStatus value of '${businessStatus}' has no possible follow up action.`
        expect(actual).toEqual(expected)
      }
    )
  })
})
