/* eslint-disable  max-len */

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
  taskContent,
  validateEntry,
  ValidationOutcome,
  validateContent,
  entryContent
} from "../../src/validation/content"

import {generateInvalidNhsNumbers, generateValidNhsNumbers} from "../utils/nhsNumber"
import {
  DEFAULT_DATE,
  FULL_URL_0,
  generateEntry,
  validTask
} from "../utils/testUtils"

describe("Unit test for overall task validation", () => {
  it("When task is valid, should return true with no issues.", async () => {
    const expectedOutcome = {valid: true, issues: undefined}
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: validTask()}

    const actual: ValidationOutcome = validateEntry(entry)

    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit test for validateContent", () => {
  it("When task is valid, should return true with no issues.", async () => {
    const expectedOutcome = {valid: true, issues: undefined}
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: validTask()}

    const actual: ValidationOutcome = validateContent(entry)

    expect(actual).toEqual(expectedOutcome)
  })

  it("When task is invalid in multiple ways, should return false with issues.", async () => {
    const task = validTask()
    task.for!.identifier!.value = "invalidNhsNumber"
    task.focus!.identifier!.system = "invalidLineItemIdCodeSystem"
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: task}

    const expectedOutcome = {valid: false, issues: "NHS number is invalid. Invalid CodeSystem(s) - LineItemID."}

    const actual: ValidationOutcome = validateContent(entry)

    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit test for taskContent", () => {
  it("When task is valid, should return empty array.", async () => {
    const task = validTask()
    const actual: Array<string> = taskContent(task)

    expect(actual).toEqual([])
  })

  it("When task is invalid in multiple ways, should return array with all issues.", async () => {
    const task = validTask()
    task.for!.identifier!.value = "invalidNhsNumber"
    task.focus!.identifier!.system = "invalidLineItemIdCodeSystem"

    const expectedOutcome = ["NHS number is invalid.", "Invalid CodeSystem(s) - LineItemID."]

    const actual: Array<string> = taskContent(task)

    expect(actual).toEqual(expectedOutcome)
  })
})

describe("Unit test for entryContent", () => {
  it("When entry is valid, should return empty array.", async () => {
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: validTask()}
    const actual: Array<string> = entryContent(entry)

    expect(actual).toEqual([])
  })

  it("When entry is invalid, should return array with issue.", async () => {
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: validTask()}
    entry.fullUrl = "invalid"
    const actual: Array<string> = entryContent(entry)

    expect(actual).toEqual(["Invalid entry fullUrl or task id."])
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
  describe("When task status is 'completed'", () => {
    it.each([
      {
        isValid: false,
        businessStatus: "With Pharmacy",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'With Pharmacy' requires follow up action."
      },
      {
        isValid: false,
        businessStatus: "With Pharmacy - preparing remainder",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'With Pharmacy - preparing remainder' requires follow up action."
      },
      {
        isValid: false,
        businessStatus: "Ready to collect",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'Ready to collect' requires follow up action."
      },
      {
        isValid: false,
        businessStatus: "ReAdY tO cOlLeCt",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'ReAdY tO cOlLeCt' requires follow up action."
      },
      {
        isValid: false,
        businessStatus: "Ready to collect - partial",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'Ready to collect - partial' requires follow up action."
      },
      {
        isValid: false,
        businessStatus: "rEaDy To ColLEcT - pArtIAl",
        expected:
          "Task.status field set to 'completed' but Task.businessStatus value of 'rEaDy To ColLEcT - pArtIAl' requires follow up action."
      },
      {isValid: true, businessStatus: "Collected", expected: undefined},
      {isValid: true, businessStatus: "Not dispensed", expected: undefined},
      {isValid: true, businessStatus: "Dispatched", expected: undefined},
      {isValid: true, businessStatus: "Ready to dispatch", expected: undefined},
      {isValid: true, businessStatus: "Ready to dispatch - partial", expected: undefined}
    ])(
      "When status is 'completed' and business status is '$businessStatus', should return expected issue.",
      ({isValid, businessStatus, expected}) => {
        const task = {status: "completed", businessStatus: {coding: [{code: businessStatus}]}}
        const actual = statuses(task as Task)
        expect(actual).toEqual(isValid ? undefined : expected)
      }
    )
  })

  describe("When task status is 'in-progress'", () => {
    it.each([
      {isValid: true, businessStatus: "With Pharmacy", expected: undefined},
      {isValid: true, businessStatus: "With Pharmacy - preparing remainder", expected: undefined},
      {isValid: true, businessStatus: "Ready to collect", expected: undefined},
      {isValid: true, businessStatus: "Ready to collect - partial", expected: undefined},
      {isValid: true, businessStatus: "Ready to dispatch", expected: undefined},
      {isValid: true, businessStatus: "Ready to dispatch - partial", expected: undefined},
      {
        isValid: false,
        businessStatus: "Collected",
        expected:
          "Task.status field set to 'in-progress' but Task.businessStatus value of 'Collected' has no possible follow up action."
      },
      {
        isValid: false,
        businessStatus: "Not dispensed",
        expected:
          "Task.status field set to 'in-progress' but Task.businessStatus value of 'Not dispensed' has no possible follow up action."
      },
      {
        isValid: false,
        businessStatus: "Dispatched",
        expected:
          "Task.status field set to 'in-progress' but Task.businessStatus value of 'Dispatched' has no possible follow up action."
      }
    ])(
      "When status is 'in-progress' and business status is '$businessStatus', should return expected issue.",
      ({isValid, businessStatus, expected}) => {
        const task = {status: "in-progress", businessStatus: {coding: [{code: businessStatus}]}}
        const actual = statuses(task as Task)
        expect(actual).toEqual(isValid ? undefined : expected)
      }
    )
  })
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
  ])(
    "When resourceType is $resourceType and type is $type, should return $expected.",
    async ({resourceType, type, expected}) => {
      const body = {resourceType: resourceType, type: type}

      const actual = transactionBundle(body)

      expect(actual).toEqual(expected)
    }
  )
})

describe("Unit tests for validation of businessStatus", () => {
  it.each(BUSINESS_STATUSES)("When businessStatus is valid, should return undefined.", async (status) => {
    const task = {businessStatus: {coding: [{code: status}]}}

    const actual = businessStatus(task as Task)

    expect(actual).toEqual(undefined)
  })

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
