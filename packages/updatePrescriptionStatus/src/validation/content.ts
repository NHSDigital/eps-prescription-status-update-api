/* eslint-disable @typescript-eslint/no-explicit-any */

import {Logger} from "@aws-lambda-powertools/logger"
import {CodeableConcept, Coding, Task} from "fhir/r4"
import {validatePrescriptionID} from "../utils/prescriptionID"
import {validateNhsNumber} from "../utils/nhsNumber"
import {validateFields} from "./fields"

type Validation = (task: Task) => string | undefined

type ValidationOutcome = {
    valid: boolean,
    issues: string | undefined
}

const ONE_DAY_IN_MS = 86400000

const BUSINESS_STATUSES = [
  "with pharmacy",
  "with pharmacy - preparing remainder",
  "ready to collect",
  "ready to collect - partial",
  "collected",
  "dispatched",
  "not dispensed"
]

const logger = new Logger({serviceName: "requestContentValidation"})

function transactionBundle(body: any): boolean {
  return body.resourceType === "Bundle" && body.type === "transaction"
}

function lastModified(task: Task): string | undefined {
  const today = new Date()
  const lastModified = new Date(task.lastModified!)

  if (isNaN(lastModified.getTime())) {
    return "Date format provided for lastModified is invalid."
  }

  if (lastModified!.valueOf() - today.valueOf() > ONE_DAY_IN_MS) {
    return "Invalid last modified value provided."
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

function resourceType(task: Task): string | undefined {
  const message = "Resource's resourceType is not 'Task'."
  const isTask = task.resourceType === "Task"
  if (!isTask) {
    return message
  }
}

// validate all codesystems in the request example

function businessStatus(task: Task): string | undefined {
  const code: string = task.businessStatus!.coding![0].code!
  if (!BUSINESS_STATUSES.includes(code.toLowerCase())) {
    return "Invalid business status."
  }
}

function statuses(task: Task): string | undefined {
  const status = task.status
  if (status === "completed") {
    const businessStatus: CodeableConcept | undefined = task.businessStatus
    if (businessStatus) {
      const coding: Coding = businessStatus.coding![0]
      const code = coding.code
      if (code && ["with pharmacy", "ready to collect"].includes(code.toLowerCase())) {
        return "Completed state indicated for a prescription status requiring patient action."
      }
    }
  }
}

function validateContent(task: Task): ValidationOutcome {
  const contentValidations: Array<Validation> = [
    businessStatus,
    lastModified,
    nhsNumber,
    prescriptionID,
    resourceType,
    statuses
  ]

  const validationOutcome: ValidationOutcome = {valid: true, issues: undefined}

  contentValidations.forEach((validation: Validation) => {
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

function validateTask(task: Task): ValidationOutcome {
  const fieldsOutcome = validateFields(task)
  if (!fieldsOutcome.valid) {
    return fieldsOutcome
  }

  return validateContent(task)
}

export {
  Validation,
  ValidationOutcome,
  BUSINESS_STATUSES,
  ONE_DAY_IN_MS,
  businessStatus,
  lastModified,
  nhsNumber,
  prescriptionID,
  resourceType,
  statuses,
  transactionBundle,
  validateTask
}
