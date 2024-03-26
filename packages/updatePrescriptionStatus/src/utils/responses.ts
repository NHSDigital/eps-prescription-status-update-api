import {Bundle, BundleEntry} from "fhir/r4"

function badRequest(diagnostics: string, taskID: string | undefined = undefined): BundleEntry {
  const bundleEntry: BundleEntry = {
    response: {
      status: "400 Bad Request",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "processing",
            severity: "error",
            diagnostics: diagnostics,
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                  code: "BAD_REQUEST",
                  display: "Bad request"
                }
              ]
            }
          }
        ]
      }
    }
  }
  if (taskID) {
    bundleEntry.fullUrl = taskID
  }
  return bundleEntry
}

function accepted(taskID: string): BundleEntry {
  return {
    fullUrl: taskID,
    response: {
      status: "200 Accepted",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "informational",
            severity: "information",
            diagnostics: "No issues detected during validation."
          }
        ]
      }
    }
  }
}

function created(taskID: string): BundleEntry {
  return {
    fullUrl: taskID,
    response: {
      status: "201 Created",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "success",
            severity: "information",
            diagnostics: "No issues detected during validation."
          }
        ]
      }
    }
  }
}

function serverError(): BundleEntry {
  return {
    response: {
      status: "500 Internal Server Error",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [
          {
            code: "exception",
            severity: "fatal",
            diagnostics: "The Server has encountered an error processing the request.",
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/http-error-codes",
                  code: "SERVER_ERROR",
                  display: "Server error"
                }
              ]
            }
          }
        ]
      }
    }
  }
}

function createSuccessResponseBundle(responseBundle: Bundle, entries: Array<BundleEntry>) {
  responseBundle.entry = []
  for (const entry of entries) {
    responseBundle.entry.push(created(entry.resource!.id!))
  }
}

export {accepted, badRequest, createSuccessResponseBundle, serverError}
