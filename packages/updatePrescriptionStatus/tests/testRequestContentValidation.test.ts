/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"
import {BundleEntry, Task} from "fhir/r4"

import {
  BUSINESS_STATUSES,
  businessStatus,
  codeSystems,
  lastModified,
  nhsNumber,
  ONE_DAY_IN_MS,
  prescriptionID,
  resourceType,
  statuses,
  transactionBundle,
  validateTask,
  ValidationOutcome
} from "../src/validation/content"

import valid from "./tasks/valid.json"
import {generateInvalidNhsNumbers, generateValidNhsNumbers} from "./utils/nhsNumber"
import {DEFAULT_DATE, generateEntry} from "./utils/testUtils"

describe("Unit test for overall task validation", () => {
  it("When task is valid, should return true with no issues.", async () => {
    const expectedOutcome = {valid: true, issues: undefined}
    const actual: ValidationOutcome = validateTask(valid as Task)
    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit tests for pre-cast validation of bundle", () => {
  it("When resourceType is not Bundle, should return false.", async () => {
    const body = {resourceType: "NotBundle"}

    const actual = transactionBundle(body)

    expect(actual).toEqual(false)
  })

  it("When type is not transaction, should return false.", async () => {
    const body = {type: "not_transaction"}

    const actual = transactionBundle(body)

    expect(actual).toEqual(false)
  })

  it("When both correct, should return true.", async () => {
    const body = {resourceType: "Bundle", type: "transaction"}

    const actual = transactionBundle(body)

    expect(actual).toEqual(true)
  })
})

describe("Unit tests for validation of lastModified", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("When lastModified is over a day in the future, should return expected issue.", async () => {
    const futureDate = new Date(DEFAULT_DATE.valueOf() + (ONE_DAY_IN_MS + 1000))
    const task = {lastModified: futureDate.toISOString()}

    const expected = "Invalid last modified value provided."

    const actual = lastModified(task as Task)

    expect(actual).toEqual(expected)
  })

  it("When last modified date format is invalid, should return expected issue.", async () => {
    const task = {lastModified: "invalid date"}

    const expected = "Date format provided for lastModified is invalid."

    const actual = lastModified(task as Task)

    expect(actual).toEqual(expected)
  })

  it("When lastModified is valid and not in the future, should return undefined.", async () => {
    const task = {lastModified: DEFAULT_DATE.toISOString()}

    const actual = lastModified(task as Task)

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
    const task = {basedOn: [{identifier: {value: testPrescriptionID}}]}

    const actual = prescriptionID(task as Task)

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
    const task = {for: {identifier: {value: generatedNhsNumber}}}

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
      const task = {status: taskStatus, businessStatus: {coding: [{code: businessStatus}]}}

      const actual = statuses(task as Task)

      expect(actual).toEqual(expected)
    }
  )
})

describe("Unit tests for validation of resourceType", () => {
  it.each([
    {
      type: "NotTask",
      expected: "Resource's resourceType is not 'Task'.",
      scenarioDescription: "When resourceType is not Task, should return expected issue."
    },
    {
      type: "Task",
      expected: undefined,
      scenarioDescription: "When resourceType is Task, should return undefined."
    }
  ])("$scenarioDescription", async ({type, expected}) => {
    const task = {resourceType: type}

    const actual = resourceType(task as Task)

    expect(actual).toEqual(expected)
  })
})

describe("Unit tests for validation of transaction bundle", () => {
  it.each([
    {
      resourceType: "NotBundle",
      type: "transaction",
      expected: false
    },
    {
      resourceType: "Bundle",
      type: "not_transaction",
      expected: false
    },
    {
      resourceType: "Bundle",
      type: "transaction",
      expected: true
    }
  ])("When resourceType is $resourceType and type is $type, should return $expected.",
    async ({resourceType, type, expected}) => {
      const body = {resourceType: resourceType, type: type}

      const actual = transactionBundle(body)

      expect(actual).toEqual(expected)
    }
  )
})

describe("Unit tests for validation of businessStatus", () => {
  it.each(BUSINESS_STATUSES)("When businessStatus is valid, should return undefined.",
    async (status) => {
      const task = {businessStatus: {coding: [{code: status}]}}

      const actual = businessStatus(task as Task)

      expect(actual).toEqual(undefined)
    }
  )

  it("When businessStatus is invalid, should return expected message.", async () => {
    const task = {businessStatus: {coding: [{code: "Invalid"}]}}

    const actual = businessStatus(task as Task)

    expect(actual).toEqual("Invalid business status.")
  })
})

describe("Unit tests for validation of codeSystems", () => {
  it("When code systems are all valid, should return undefined.", async () => {
    const entry = generateEntry(0) as BundleEntry

    const actual = codeSystems(entry.resource as Task)

    expect(actual).toEqual(undefined)
  })

  it("When code systems are invalid, should return expected message.", async () => {
    const entry = generateEntry(0) as BundleEntry
    const task = entry.resource as Task
    task.focus!.identifier!.system = "invalidLineItemIdCodeSystem"
    task.for!.identifier!.system = "invalidNhsNumberCodeSystem"

    const actual = codeSystems(entry.resource as Task)

    expect(actual).toEqual("Invalid CodeSystem(s) - LineItemID, PatientNHSNumber.")
  })
})
