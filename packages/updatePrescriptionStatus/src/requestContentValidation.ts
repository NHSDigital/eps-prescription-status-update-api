// https://digital.nhs.uk/developer/api-catalogue/
// electronic-prescription-service-fhir#post-/FHIR/R4/$process-message-prescription-order
// /^[0-9a-fA-F]{6}-[0-9a-fA-F]{6}-[0-9a-fA-F]{5}[0-9a-zA-Z+]{1}

import {Logger} from "@aws-lambda-powertools/logger"
import {Bundle, Task} from "fhir/r4"

type Validation = (bundle: Bundle) => Array<Issue>

type Issue = {
    fhirPath: string,
    description: string
}

const ONE_DAY_IN_MS = 86400000
const logger = new Logger({serviceName: "requestContentValidation"})

function lastModified(bundle: Bundle): Array<Issue> {
  const issues: Array<Issue> = []

  const today = new Date()

  bundle.entry?.forEach((entry, entryIndex) => {
    const fhirPath = `entry[${entryIndex}].resource.lastModified`
    const task: Task = entry.resource as Task
    const lastModified = new Date(task.lastModified!)

    if (isNaN(lastModified.getTime())) {
      issues.push({fhirPath: fhirPath, description: "Date format provided for lastModified is invalid."})
    }

    if (lastModified!.valueOf() - today.valueOf() > ONE_DAY_IN_MS) {
      issues.push(
        {fhirPath: fhirPath, description: "Date provided for lastModified is more than one day in the future."}
      )
    }
  })
  return issues
}

function validate(bundle: Bundle): Array<Issue> {
  const validations: Array<Validation> = [
    lastModified
  ]
  const issues: Array<Issue> = []

  validations.forEach((validation: Validation) => {
    try {
      issues.concat(validation(bundle))
    } catch(e) {
      const message = `Unhandled error during validation of ${validation.name}.`
      logger.error(`${message}: ${e}`)
      issues.push({fhirPath: "Unknown", description: message})
    }
  })

  return issues
}

export {Issue, ONE_DAY_IN_MS, lastModified, validate}
