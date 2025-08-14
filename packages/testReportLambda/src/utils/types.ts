/** REQUEST BODY */

export interface TestReportRequestBody {
  connectingSystemName: string;
  prescriptionIds: Array<string>;
}

/** RESPONSE BODY */

export interface TestReportResponseBody {
  systemName: string;
  /** UNIX timestamp of first PSU request in pack */
  firstStatusDate: number;
  /** UNIX timestamp of last PSU request in pack */
  lastStatusDate: number;
  prescriptionId: string;
  statusDataArray: Array<StatusDataResponse>;
}

export type PsuIsSuccess = "success" | "fail"

export interface FailedDataResponse {
  submittedStatus: string;
  /** UNIX timestamp */
  submittedLastUpdatedTimestamp: number
  submittedTerminalStatus: boolean;
  storedStatus: string;
  /** UNIX timestamp */
  storedTimestamp: number
  storedTerminalStatus: boolean
}

export interface StatusDataResponse {
  status: string;
  /* UNIX timestamp of this prescription status update */
  timestamp: number;
  isSuccess: PsuIsSuccess;
  failureData?: FailedDataResponse;
}

/** LOG SEARCHING TYPES */
import {FilteredLogEvent} from "@aws-sdk/client-cloudwatch-logs"

export interface LogSearchOptions {
  /** UNIX epoch, milliseconds */
  startTime?: number
  /** UNIX epoch, milliseconds */
  endTime?: number
  /** Max number of events to collect per term before stopping pagination. Defaults to 1000. */
  limitPerTerm?: number
  /** Max number of pages to request per term. Defaults to 50. */
  pageLimit?: number
  /** Optional explicit log stream name filter. */
  logStreamNames?: Array<string>
}

export interface TermSearchResult {
  term: string
  matches: Array<FilteredLogEvent>
}
