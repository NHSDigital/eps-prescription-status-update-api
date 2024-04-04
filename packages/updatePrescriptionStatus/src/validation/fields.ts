import {Task} from "fhir/r4"
import {Validation, ValidationOutcome} from "./content"
import {Logger} from "@aws-lambda-powertools/logger"

const logger = new Logger({serviceName: "fields"})

export function fields(task: Task): string | undefined {
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
  if (missingFields.length > 0) {
    return `Missing required field(s) - ${missingFields.join(", ")}.`
  }
}

export function validateFields(task: Task): ValidationOutcome {
  const validationOutcome: ValidationOutcome = {valid: true, issues: undefined}
  try {
    const issue = fields(task)
    if (issue) {
      validationOutcome.valid = false
      validationOutcome.issues = issue
    }
  } catch(e) {
    const message = `Unhandled error during validation of fields.`
    logger.error(`${message}: ${e}`)
    validationOutcome.valid = false
    validationOutcome.issues = message
  }
  return validationOutcome
}
