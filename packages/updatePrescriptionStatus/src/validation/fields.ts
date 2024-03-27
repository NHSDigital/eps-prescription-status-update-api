import {Task} from "fhir/r4"
import {Validation, ValidationOutcome} from "./content"
import {Logger} from "@aws-lambda-powertools/logger"

const logger = new Logger({serviceName: "fields"})

function fields(task: Task): string | undefined {
  const requiredFields: Array<Validation> = [
    (t: Task) => t.basedOn?.[0]?.identifier?.value ? undefined : "PrescriptionID",
    (t: Task) => t.for?.identifier?.value ? undefined: "PatientNHSNumber",
    (t: Task) => t.owner?.identifier?.value ? undefined: "PharmacyODSCode",
    (t: Task) => t.id ? undefined: "TaskID",
    (t: Task) => t.focus?.identifier?.value ? undefined: "LineItemID",
    (t: Task) => t.status ? undefined: "TerminalStatus",
    (t: Task) => t ? undefined: "RequestMessage"
  ]
  const missingFields: Array<string> = []
  for (const field of requiredFields) {
    const missingField = field(task)
    if (missingField) {
      missingFields.push(missingField)
    }
  }
  if (missingFields.length > 0) {
    return `Missing required fields - ${missingFields.join(", ")}.`
  }
}

function validateFields(task: Task): ValidationOutcome {
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

export {fields, validateFields}
