// https://digital.nhs.uk/developer/api-catalogue/
// electronic-prescription-service-fhir#post-/FHIR/R4/$process-message-prescription-order
// /^[0-9a-fA-F]{6}-[0-9a-fA-F]{6}-[0-9a-fA-F]{5}[0-9a-zA-Z+]{1}

import {Logger} from "@aws-lambda-powertools/logger"
import {Task} from "fhir/r4"

type Validation = (task: Task) => string | undefined

type ValidationOutcome = {
    valid: boolean,
    issues: Array<string>
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

function validateTask(task: Task): ValidationOutcome {
  const validations: Array<Validation> = [
    lastModified
  ]
  const validationOutcome: ValidationOutcome = {valid: true, issues: []}

  validations.forEach((validation: Validation) => {
    try {
      const issue = validation(task)
      if (issue) {
        validationOutcome.valid = false
        validationOutcome.issues.push(issue)
      }
    } catch(e) {
      const message = `Unhandled error during validation of ${validation.name}.`
      logger.error(`${message}: ${e}`)
      validationOutcome.valid = false
      validationOutcome.issues.push(message)
    }
  })

  return validationOutcome
}

export {ValidationOutcome, ONE_DAY_IN_MS, lastModified, validateTask}
