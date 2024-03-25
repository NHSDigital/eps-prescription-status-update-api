import {Bundle, BundleEntry, OperationOutcome} from "fhir/r4"

function badRequest(diagnostics: string): OperationOutcome {
  return {
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

function accepted(): OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [
      {
        code: "informational",
        severity: "information",
        diagnostics: "No issues detected during validation"
      }
    ]
  }
}

function created(): OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: [
      {
        code: "success",
        severity: "information",
        diagnostics: "No issues detected during validation"
      }
    ]
  }
}

function serverError(): OperationOutcome {
  return {
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

function createSuccessResponseBundle(responseBundle: Bundle, entries: Array<BundleEntry>) {
  responseBundle.entry = []
  for (const entry of entries) {
    responseBundle.entry.push({
      fullUrl: entry.resource?.id,
      response: {
        status: "201 Created",
        outcome: created()
      }
    })
  }
}

function replaceResponseBundleEntry(responseBundle: Bundle, entry: BundleEntry) {
  responseBundle.entry!.forEach((e, i) => {
    if (e.fullUrl === entry.fullUrl) {
      responseBundle.entry![i] = entry
    }
  })
}

export {accepted, badRequest, createSuccessResponseBundle, replaceResponseBundleEntry, serverError}
