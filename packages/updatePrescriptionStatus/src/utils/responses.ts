import {Bundle, BundleEntry} from "fhir/r4"

export function bundleWrap(entries: Array<BundleEntry>): Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: entries
  }
}

export function badRequest(diagnostics: string, fullUrl: string | undefined = undefined): BundleEntry {
  const bundleEntry: BundleEntry = {
    response: {
      status: "400 Bad Request",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "processing",
            severity: "error",
            diagnostics: diagnostics,
            details: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/Spine-ErrorOrWarningCode",
                  code: "INVALID_VALUE",
                  display: "Invalid value"
                }
              ]
            }
          }
        ]
      }
    }
  }
  if (fullUrl) {
    bundleEntry.fullUrl = fullUrl
  }
  return bundleEntry
}

export function accepted(fullUrl: string): BundleEntry {
  return {
    fullUrl: fullUrl,
    response: {
      status: "200 Accepted",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
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

function created(fullUrl: string): BundleEntry {
  return {
    fullUrl: fullUrl,
    response: {
      status: "201 Created",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
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

export function serverError(): BundleEntry {
  return {
    response: {
      status: "500 Internal Server Error",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
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

export function createSuccessResponseEntries(entries: Array<BundleEntry>) {
  return entries.map(e => created(e.fullUrl!))
}
