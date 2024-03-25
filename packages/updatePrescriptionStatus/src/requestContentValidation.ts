import {Logger} from "@aws-lambda-powertools/logger"
import {CodeableConcept, Coding, Task} from "fhir/r4"
import {validatePrescriptionID} from "./utils/prescriptionID"
import {validateNhsNumber} from "./utils/nhsNumber"

type Validation = (task: Task) => string | undefined

type ValidationOutcome = {
    valid: boolean,
    issues: string | undefined
}

const ONE_DAY_IN_MS = 86400000

const logger = new Logger({serviceName: "requestContentValidation"})

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
    return `Missing required fields - ${missingFields.join(", ")}`
  }
}

function lastModified(task: Task): string | undefined {
  const today = new Date()
  const lastModified = new Date(task.lastModified!)

  if (isNaN(lastModified.getTime())) {
    return "Date format provided for lastModified is invalid."
  }

  if (lastModified!.valueOf() - today.valueOf() > ONE_DAY_IN_MS) {
    return "Date provided for lastModified is more than one day in the future."
  }
}

function prescriptionID(task: Task): string | undefined {
  const message = "Prescription ID is invalid."
  const prescriptionID = task.basedOn?.[0].identifier?.value
  if (!prescriptionID) {
    return message
  }
  return validatePrescriptionID(prescriptionID) ? undefined : message
}

function nhsNumber(task: Task): string | undefined {
  const message = "NHS number is invalid."
  const nhsNumber = task.for?.identifier?.value
  if (!nhsNumber) {
    return message
  }
  return validateNhsNumber(nhsNumber) ? undefined : message
}

function status(task: Task): string | undefined {
  const status = task.status
  if (status === "completed") {
    const businessStatus: CodeableConcept | undefined = task.businessStatus
    if (businessStatus) {
      const coding: Coding = businessStatus.coding![0]
      const code = coding.code
      if (code && ["with pharmacy", "ready to collect"].includes(code.toLowerCase())) {
        return `Status cannot be 'completed' when business status is '${code}'.`
      }
    }
  }
}

function validateTask(task: Task): ValidationOutcome {
  const validations: Array<Validation> = [
    fields,
    lastModified,
    prescriptionID,
    nhsNumber,
    status
  ]
  const validationOutcome: ValidationOutcome = {valid: true, issues: undefined}

  validations.forEach((validation: Validation) => {
    const issues: Array<string> = []
    try {
      const issue = validation(task)
      if (issue) {
        issues.push(issue)
      }
    } catch(e) {
      const message = `Unhandled error during validation of ${validation.name}.`
      logger.error(`${message}: ${e}`)
      issues.push(message)
    }
    if (issues.length > 0) {
      validationOutcome.valid = false
      validationOutcome.issues = issues.join(" ")
    }
  })

  return validationOutcome
}

export {ValidationOutcome, ONE_DAY_IN_MS, lastModified, nhsNumber, prescriptionID, status, validateTask}
