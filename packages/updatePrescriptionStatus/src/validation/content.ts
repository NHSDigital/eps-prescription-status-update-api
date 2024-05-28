/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BundleEntry,
  CodeableConcept,
  Coding,
  Task
} from "fhir/r4"
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

export const BUSINESS_STATUSES = [
  "with pharmacy",
  "with pharmacy - preparing remainder",
  "ready to collect",
  "ready to collect - partial",
  "collected",
  "ready to dispatch",
  "ready to dispatch - partial",
  "dispatched",
  "not dispensed"
]

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

export function statuses(task: Task): string | undefined {
  const status = task.status
  if (status === "completed") {
    const businessStatus: CodeableConcept | undefined = task.businessStatus
    if (businessStatus) {
      const coding: Coding = businessStatus.coding![0]
      const code = coding.code

      const patientActionRequiredStatuses = [
        "with pharmacy",
        "with pharmacy - preparing remainder",
        "ready to collect",
        "ready to collect - partial",
        "ready to dispatch",
        "ready to dispatch - partial"
      ]

      if (code && patientActionRequiredStatuses.includes(code.toLowerCase())) {
        return "Completed state indicated for a prescription status requiring patient action."
      }
    }
  }
}

export function taskContent(task: Task): Array<string> {
  const contentValidations: Array<TaskValidation> = [
    businessStatus,
    lastModified,
    nhsNumber,
    prescriptionID,
    resourceType,
    statuses,
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
