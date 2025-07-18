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

export interface LastNotificationStateType {
  NHSNumber: string
  ODSCode: string
  RequestId: string // x-request-id header
  SQSMessageID?: string // The SQS message ID
  DeliveryStatus: string
  NotifyMessageID?: string // The UUID we got back from Notify for the submitted message
  NotifyMessageReference: string // The references we generated for the message
  NotifyMessageBatchReference?: string // As above
  LastNotifiedPrescriptionStatus: string
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number // DynamoDB expiration time (UNIX timestamp)
}
