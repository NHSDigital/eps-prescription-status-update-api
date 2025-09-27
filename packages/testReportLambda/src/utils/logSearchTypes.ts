/** LOG SEARCHING TYPES */

import {TestReportLogMessagePayload} from "@PrescriptionStatusUpdate_common/commonTypes"

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

export interface PrescriptionIdSearchResult {
    prescriptionId: string
    logEvents: ParsedMessages
}

/** Log message contents */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

// Our aws log envelope
export interface BaseLogEnvelope {
    level: LogLevel
    message: string
    /** ISO-8601 */
    timestamp: string
    service: string
}

export interface LambdaRuntimeMeta {
    cold_start: boolean
    function_arn: string
    function_memory_size: `${number}` | number
    function_name: string
    function_request_id: string
    sampling_rate: number
    xray_trace_id: string
    "x-correlation-id"?: string
    "apigw-request-id"?: string
    "x-request-id"?: string
}

export type UpdatePrescriptionStatusLog =
    BaseLogEnvelope &
    LambdaRuntimeMeta &
    TestReportLogMessagePayload

/** Convenience alias for your function’s return type */
export type ParsedMessages = Array<UpdatePrescriptionStatusLog>
