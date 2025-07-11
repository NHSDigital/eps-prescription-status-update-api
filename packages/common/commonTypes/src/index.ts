export interface PSUDataItem {
  LastModified: string
  LineItemID: string
  PatientNHSNumber: string
  PharmacyODSCode: string
  PrescriptionID: string
  RepeatNo?: number
  RequestID: string
  Status: string
  TaskID: string
  TerminalStatus: string
  ApplicationName: string
  ExpiryTime: number
}

export interface NotifyDataItem {
  PatientNHSNumber: string
  PharmacyODSCode: string
  RequestID: string
  TaskID: string
  Status: string
}
