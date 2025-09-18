export interface TestReportLogMessagePayload {
  prescriptionID: string
  taskID: string
  appName: string
  lineItemID: string | undefined
  currentStatus: string | undefined
}
