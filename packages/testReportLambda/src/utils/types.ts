/** REQUEST BODY */

export interface TestReportRequestBody {
  connectingSystemName: string;
  prescriptionIds: Array<string>;
}

/** RESPONSE BODY */

export interface TestReportResponseBody {
  systemName: string;
  /** ISO 8061 timestamp of first PSU request in pack */
  firstStatusDate: string;
  /** ISO 8061 timestamp of last PSU request in pack */
  lastStatusDate: string;
  statusUpdates: Array<PrescriptionStatuses>;
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
