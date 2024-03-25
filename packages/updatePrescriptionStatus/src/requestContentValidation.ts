import {Logger} from "@aws-lambda-powertools/logger"
import {Task} from "fhir/r4"
import {validatePrescriptionID} from "./utils/prescriptionID"
import {validateNhsNumber} from "./utils/nhsNumber"

type Validation = (task: Task) => string | undefined

type ValidationOutcome = {
    valid: boolean,
    issues: string | undefined
}

const ONE_DAY_IN_MS = 86400000

const logger = new Logger({serviceName: "requestContentValidation"})

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

function validateTask(task: Task): ValidationOutcome {
  const validations: Array<Validation> = [
    lastModified,
    prescriptionID,
    nhsNumber
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

export {ValidationOutcome, ONE_DAY_IN_MS, lastModified, nhsNumber, prescriptionID, validateTask}
