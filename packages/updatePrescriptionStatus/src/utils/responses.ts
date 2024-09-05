import {bundleEntryType as requestBundleEntryType} from "../schema/request"
import {bundleEntryType, bundleType, outcomeType} from "../schema/response"

export function bundleWrap(entries: Array<bundleEntryType>): bundleType {
  return {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: entries
  }
}

export function badRequest(diagnostics: Array<string>, fullUrl: string | undefined = undefined): bundleEntryType {
  const bundleEntry: bundleEntryType = {
    response: {
      status: "400 Bad Request",
      outcome: badRequestOutcome(diagnostics)
    }
  }
  if (fullUrl) {
    bundleEntry.fullUrl = fullUrl
  }
  return bundleEntry
}

export function badRequestOutcome(diagnostics: Array<string>): outcomeType {
  return {
    resourceType: "OperationOutcome",
    meta: {
      lastUpdated: new Date().toISOString()
    },
    issue: diagnostics.map((diagnostic) => (
      {
        code: "value",
        severity: "error",
        diagnostics: diagnostic
      }
    ))
  }
}

export function timeoutResponse(): bundleEntryType {
  return {
    response: {
      status: "504 The request timed out",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "timeout",
            severity: "fatal",
            diagnostics: "The Server has timed out while processing the request sent by the client."
          }
        ]
      }
    }
  }
}

export function accepted(fullUrl: string): bundleEntryType {
  return {
    fullUrl: fullUrl,
    response: {
      status: "200 OK",
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "informational",
            severity: "information",
            diagnostics: "Data not committed due to issues in other entries."
          }
        ]
      }
    }
  }
}

function created(fullUrl: string): bundleEntryType {
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
            code: "informational",
            severity: "information",
            diagnostics: "No issues detected during validation."
          }
        ]
      }
    }
  }
}

export function serverError(): bundleEntryType {
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
            diagnostics: "The Server has encountered an error processing the request."
          }
        ]
      }
    }
  }
}

export function conflictDuplicate(taskId: string): bundleEntryType {
  return {
    response: {
      status: "409 Conflict",
      location: `Task/${taskId}`,
      lastModified: new Date().toISOString(),
      outcome: {
        resourceType: "OperationOutcome",
        meta: {
          lastUpdated: new Date().toISOString()
        },
        issue: [
          {
            code: "duplicate",
            severity: "error",
            diagnostics:
              "Request contains a task id and prescription id identical to a record already in the data store."
          }
        ]
      }
    }
  }
}

export function createSuccessResponseEntries(entries: Array<requestBundleEntryType>) {
  return entries.map((e) => created(e.fullUrl))
}
