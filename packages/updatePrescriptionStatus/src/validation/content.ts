/* eslint-disable @typescript-eslint/no-explicit-any, max-len */

import {validatePrescriptionID} from "../utils/prescriptionID"
import {validateNhsNumber} from "../utils/nhsNumber"
import {bundleEntryType, taskType} from "../schema/request"

export type TaskValidation = (task: taskType) => string | undefined
export type BundleEntryValidation = (bundleEntry: bundleEntryType) => string | undefined

export type ValidationOutcome = {
  valid: boolean
  issues: Array<string>
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

const VALID_COMPLETED_STATUSES = COMPLETED_ONLY_BUSINESS_STATUSES.concat(AGNOSTIC_BUSINESS_STATUSES)
const VALID_IN_PROGRESS_STATUSES = IN_PROGRESS_ONLY_BUSINESS_STATUSES.concat(AGNOSTIC_BUSINESS_STATUSES)

export function entryContent(entry: bundleEntryType): Array<string> {
  return `urn:uuid:${entry.resource.id}` === entry.fullUrl ? [] : ["Entry fullUrl does not match task id."]
}

export function lastModified(task: taskType): string | undefined {
  const today = new Date()
  const lastModified = new Date(task.lastModified!)

  if (isNaN(lastModified.getTime())) {
    return "Date format provided for lastModified is invalid."
  }

  if (lastModified.valueOf() - today.valueOf() > ONE_DAY_IN_MS) {
    return "Last modified value was more than one day in the future."
  }
}

export function prescriptionID(task: taskType): string | undefined {
  const message = "Prescription ID is invalid."
  if (!validatePrescriptionID(task.basedOn[0].identifier.value)) {
    return message
  }
}

export function nhsNumber(task: taskType): string | undefined {
  const message = "NHS number is invalid."
  if (!validateNhsNumber(task.for.identifier.value)) {
    return message
  }
}

export function nhsNumberRange(task: taskType): string | undefined {
  type Range = {low: number; high: number; description?: string}

  const validRanges: Array<Range> = [
    {low: 3_113_000_000, high: 3_200_000_000},
    {low: 4_000_000_000, high: 4_999_999_999},
    {low: 6_000_000_000, high: 7_999_999_999},
    {low: 9_000_000_000, high: 9_999_999_999}
  ]

  const nhsNumber = Number(task.for.identifier.value)
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

export function taskStatusAgainstBusinessStatus(task: taskType): string | undefined {
  const status = task.status
  const businessStatus: string = task.businessStatus.coding[0].code
  const lowercaseCode = businessStatus.toLowerCase()

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

export function taskContent(task: taskType): Array<string> {
  const contentValidations: Array<TaskValidation> = [
    lastModified,
    nhsNumber,
    nhsNumberRange,
    prescriptionID,
    taskStatusAgainstBusinessStatus
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

export function validateEntry(entry: bundleEntryType): ValidationOutcome {
  const issues: Array<string> = []
  entryContent(entry).forEach((f) => issues.push(f))
  taskContent(entry.resource).forEach((f) => issues.push(f))

  return {valid: issues.length === 0, issues: issues}
}
