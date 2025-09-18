/** LOG SEARCHING TYPES */

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
    matches: ParsedMessages
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

export interface PrescriptionStatusUpdateFields {
    prescriptionID: string
    lineItemID: string
    nhsNumber: string
    pharmacyODSCode: string
    applicationName: string
    /** ISO-8601 business timestamp */
    when: string
    interval: number
    // Status strings (this is what we really care about)
    newStatus: string
    previousStatus: string
    newTerminalStatus: string
    previousTerminalStatus: string
}

export type UpdatePrescriptionStatusLog =
    BaseLogEnvelope &
    LambdaRuntimeMeta &
    PrescriptionStatusUpdateFields

/** Convenience alias for your function’s return type */
export type ParsedMessages = Array<UpdatePrescriptionStatusLog>
