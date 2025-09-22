/** REQUEST BODY */

export interface TestReportRequestBody {
  connectingSystemName: string;
  prescriptionIds: Array<string>;
}

/** RESPONSE BODY */

// For each status update, build a list of successes
export interface TestReportSuccesses {
  status: string
  timestamp: string // ISO 8061
}

// For each failure (i.e. log message event), build a list of reasons
export interface TestReportFailures {
  message: string // the log message
  submittedStatus: string
  submittedTimestamp: string // ISO 8061
  submittedTerminalStatus: string
  // Only logged if they're known
  storedStatus?: string
  storedTimestamp?: string // ISO 8061
  storedTerminalStatus?: string
}

export interface TestReportPrescriptionPackage {
  prescriptionID: string
  successes: Array<TestReportSuccesses>
  failures: Array<TestReportFailures>
}

export interface TestReportResponseBody {
  systemName: string;
  /** ISO 8061 timestamp of first PSU request in pack */
  firstStatusDate: string;
  /** ISO 8061 timestamp of last PSU request in pack */
  lastStatusDate: string;
  prescriptionIdResults: Array<TestReportPrescriptionPackage>;
}

export type PsuIsSuccess = "success" | "fail"

export interface FailedDataResponse {
  submittedStatus: string;
  /** ISO 8061 timestamp */
  submittedLastUpdatedTimestamp: string
  submittedTerminalStatus: boolean;
  storedStatus: string;
  /** ISO 8061 timestamp */
  storedTimestamp: string
  storedTerminalStatus: boolean
}

export interface PrescriptionStatuses {
  prescriptionId: string;
  statusDataArray: Array<StatusDataResponse>;
}

export interface StatusDataResponse {
  status: string;
  /* ISO 8061 timestamp of this prescription status update */
  timestamp: string;
  isSuccess: PsuIsSuccess;
  failureData?: FailedDataResponse;
}
