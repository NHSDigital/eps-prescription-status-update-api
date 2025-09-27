export interface TestReportLogMessagePayload {
  prescriptionID: string
  taskID: string
  appName: string
  lineItemID: string
  currentStatus: string
  currentTerminalStatus: string
  currentTimestamp: string // ISO 8061
  // Only logged if known
  previousStatus?: string
  previousTerminalStatus?: string
  previousTimestamp?: string // ISO 8061
}
