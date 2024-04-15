import {BundleEntry, Task} from "fhir/r4"
import {Validation, ValidationOutcome} from "./content"

export function entryFields(entry: BundleEntry): Array<string> {
  return entry.fullUrl ? [] : ["FullUrl"]
}

export function taskFields(task: Task): Array<string> {
  const requiredFields: Array<Validation> = [
    (t: Task) => t.lastModified ? undefined : "LastModified",
    (t: Task) => t.focus?.identifier?.value ? undefined : "LineItemID",
    (t: Task) => t.for?.identifier?.value ? undefined : "PatientNHSNumber",
    (t: Task) => t.owner?.identifier?.value ? undefined : "PharmacyODSCode",
    (t: Task) => t.basedOn?.[0].identifier?.value ? undefined : "PrescriptionID",
    (t: Task) => t.businessStatus?.coding?.[0].code ? undefined : "Status",
    (t: Task) => t.id ? undefined : "TaskID",
    (t: Task) => t.status ? undefined : "TerminalStatus"
  ]
  const missingFields: Array<string> = []
  for (const field of requiredFields) {
    const missingField = field(task)
    if (missingField) {
      missingFields.push(missingField)
    }
  }
  return missingFields
}

export function validateFields(entry: BundleEntry): ValidationOutcome {
  const validationOutcome: ValidationOutcome = {valid: true, issues: undefined}
  const missingFields: Array<string> = []
  const task = entry.resource as Task

  entryFields(entry).forEach(f => missingFields.push(f))
  taskFields(task).forEach(f => missingFields.push(f))
  if (missingFields.length > 0) {
    validationOutcome.valid = false
    validationOutcome.issues = `Missing required field(s) - ${missingFields.join(", ")}.`
  }

  return validationOutcome
}
