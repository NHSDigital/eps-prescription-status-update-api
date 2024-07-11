/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {BundleEntry, Task} from "fhir/r4"
import {validatePrescriptionID} from "../utils/prescriptionID"
import {validateNhsNumber} from "../utils/nhsNumber"
import {validateFields} from "./fields"

export type TaskValidation = (task: Task) => string | undefined
export type BundleEntryValidation = (bundleEntry: BundleEntry) => string | undefined

export type ValidationOutcome = {
  valid: boolean
  issues: string | undefined
}

export const ONE_DAY_IN_MS = 86400000
export const LINE_ITEM_ID_CODESYSTEM = "https://fhir.nhs.uk/Id/prescription-order-item-number"
export const NHS_NUMBER_CODESYSTEM = "https://fhir.nhs.uk/Id/nhs-number"
export const ODS_CODE_CODESYSTEM = "https://fhir.nhs.uk/Id/ods-organization-code"
export const PRESCRIPTION_ID_CODESYSTEM = "https://fhir.nhs.uk/Id/prescription-order-number"
export const STATUS_CODESYSTEM = "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt"

const COMPLETED_ONLY_BUSINESS_STATUSES = ["collected", "not dispensed", "dispatched"]
const IN_PROGRESS_ONLY_BUSINESS_STATUSES = [
  "with pharmacy",
  "with pharmacy - preparing remainder",
  "ready to collect - partial",
  "ready to dispatch - partial"
]
const AGNOSTIC_BUSINESS_STATUSES = ["ready to dispatch", "ready to collect"]

export const BUSINESS_STATUSES = COMPLETED_ONLY_BUSINESS_STATUSES.concat(IN_PROGRESS_ONLY_BUSINESS_STATUSES).concat(
  AGNOSTIC_BUSINESS_STATUSES
)
const VALID_COMPLETED_STATUSES = COMPLETED_ONLY_BUSINESS_STATUSES.concat(AGNOSTIC_BUSINESS_STATUSES)
const VALID_IN_PROGRESS_STATUSES = IN_PROGRESS_ONLY_BUSINESS_STATUSES.concat(AGNOSTIC_BUSINESS_STATUSES)

export function transactionBundle(body: any): boolean {
  return body.resourceType === "Bundle" && body.type === "transaction"
}

export function entryContent(entry: BundleEntry): Array<string> {
  return `urn:uuid:${entry.resource!.id}` === entry.fullUrl! ? [] : ["Invalid entry fullUrl or task id."]
}

export function lastModified(task: Task): string | undefined {
  const today = new Date()
  const lastModified = new Date(task.lastModified!)

  if (isNaN(lastModified.getTime())) {
    return "Date format provided for lastModified is invalid."
  }

  if (lastModified.valueOf() - today.valueOf() > ONE_DAY_IN_MS) {
    return "Invalid last modified value provided."
  }
}

export function prescriptionID(task: Task): string | undefined {
  const message = "Prescription ID is invalid."
  const prescriptionID = task.basedOn?.[0].identifier?.value
  if (!prescriptionID) {
    return message
  }
  return validatePrescriptionID(prescriptionID) ? undefined : message
}

export function nhsNumber(task: Task): string | undefined {
  const message = "NHS number is invalid."
  const nhsNumber = task.for?.identifier?.value
  if (!nhsNumber) {
    return message
  }
  return validateNhsNumber(nhsNumber) ? undefined : message
}

export function nhsNumberRange(task: Task): string | undefined {
  type Range = {low: number; high: number; description?: string}

  const validRanges: Array<Range> = [
    {low: 3_113_000_000, high: 3_200_000_000},
    {low: 4_000_000_000, high: 4_999_999_999},
    {low: 6_000_000_000, high: 7_999_999_999}
  ]

  const nhsNumber = Number(task.for!.identifier!.value)
  for (const range of validRanges) {
    if (range.low <= nhsNumber && nhsNumber <= range.high) {
      return undefined
    }
  }

  const invalidRanges: Array<Range> = [
    {low: 101_000_000, high: 3_112_999_999, description: "Scottish"},
    {low: 3_200_000_001, high: 3_999_999_999, description: "Northern Irish"}
  ]

  for (const range of invalidRanges) {
    if (range.low <= nhsNumber && nhsNumber <= range.high) {
      return `NHS number is in the ${range.description} range.`
    }
  }

  return "NHS number is not in a known, valid range."
}

export function resourceType(task: Task): string | undefined {
  const message = "Resource's resourceType is not 'Task'."
  const isTask = task.resourceType === "Task"
  if (!isTask) {
    return message
  }
}

export function codeSystems(task: Task): string | undefined {
  const systems: Array<TaskValidation> = [
    (t: Task) => (t.focus!.identifier!.system === LINE_ITEM_ID_CODESYSTEM ? undefined : "LineItemID"),
    (t: Task) => (t.for!.identifier!.system === NHS_NUMBER_CODESYSTEM ? undefined : "PatientNHSNumber"),
    (t: Task) => (t.owner!.identifier!.system === ODS_CODE_CODESYSTEM ? undefined : "PharmacyODSCode"),
    (t: Task) => (t.basedOn![0].identifier!.system === PRESCRIPTION_ID_CODESYSTEM ? undefined : "PrescriptionID"),
    (t: Task) => (t.businessStatus!.coding![0].system === STATUS_CODESYSTEM ? undefined : "Status")
  ]
  const incorrectCodeSystems: Array<string> = []
  for (const system of systems) {
    const incorrect = system(task)
    if (incorrect) {
      incorrectCodeSystems.push(incorrect)
    }
  }
  if (incorrectCodeSystems.length > 0) {
    return `Invalid CodeSystem(s) - ${incorrectCodeSystems.join(", ")}.`
  }
}

export function businessStatus(task: Task): string | undefined {
  const code: string = task.businessStatus!.coding![0].code!
  if (!BUSINESS_STATUSES.includes(code.toLowerCase())) {
    return "Invalid business status."
  }
}

export function taskStatusAgainstBusinessStatus(task: Task): string | undefined {
  const status = task.status
  const businessStatus: string = task.businessStatus!.coding![0].code!
  const lowercaseCode = businessStatus.toLowerCase()

  const validStatus = BUSINESS_STATUSES.includes(lowercaseCode)
  if (!validStatus) {
    return `Unsupported Task.businessStatus '${businessStatus}'.`
  }

  const validCompleteStatus = VALID_COMPLETED_STATUSES.includes(lowercaseCode)
  if (status === "completed" && !validCompleteStatus) {
    return `Task.status field set to '${status}' but Task.businessStatus value of '${businessStatus}' requires follow up action.`
  }

  const validInProgressStatus = VALID_IN_PROGRESS_STATUSES.includes(lowercaseCode)
  if (status === "in-progress" && !validInProgressStatus) {
    return `Task.status field set to '${status}' but Task.businessStatus value of '${businessStatus}' has no possible follow up action.`
  }

  return undefined
}

export function taskContent(task: Task): Array<string> {
  const contentValidations: Array<TaskValidation> = [
    businessStatus,
    lastModified,
    nhsNumber,
    prescriptionID,
    resourceType,
    taskStatusAgainstBusinessStatus,
    codeSystems
  ]

  const issues: Array<string> = []
  contentValidations.forEach((validation: TaskValidation) => {
    const issue = validation(task)
    if (issue) {
      issues.push(issue)
    }
  })

  return issues
}

export function validateContent(entry: BundleEntry): ValidationOutcome {
  const validationOutcome: ValidationOutcome = {valid: true, issues: undefined}
  const issues: Array<string> = []
  const task = entry.resource as Task

  entryContent(entry).forEach((f) => issues.push(f))
  taskContent(task).forEach((f) => issues.push(f))
  if (issues.length > 0) {
    validationOutcome.valid = false
    validationOutcome.issues = issues.join(" ")
  }

  return validationOutcome
}

export function validateEntry(entry: BundleEntry): ValidationOutcome {
  const fieldsOutcome = validateFields(entry)
  if (!fieldsOutcome.valid) {
    return fieldsOutcome
  }

  return validateContent(entry)
}
