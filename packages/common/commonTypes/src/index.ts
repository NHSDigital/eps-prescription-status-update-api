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
  // (Optional, legacy batch-processors only) Indicates that {@link LastModified} is postdated;
  // contains the ISO 8601 timestamp when the postdated update was set.
  // todo: This field needs to be passed to the sqs message for post-dated updates
  // FIXME: This should be called PostDatedLastUpdatedSetAt
  PostDatedLastModifiedSetAt?: string
}

export interface NotifyDataItem {
  PatientNHSNumber: string
  PharmacyODSCode: string
  RequestID: string
  TaskID: string
  Status: string
}

// TODO: This should be removed when we stop supporting post-dated updates
export interface PostDatedNotifyDataItem extends NotifyDataItem {
  LastModified: string
  PostDatedLastModifiedSetAt: string // This is the meta.lastUpdated field from the FHIR resource
  PrescriptionID: string
  LineItemID: string
}

/**
 * The fields stored in the Notifications table potentially updated by the Notify callback.
 */
export interface NotificationUpdate {
  // normal convention is camelCase, however preserving as we already have records in DynamoDB
  MessageStatus?: string
  MessageStatusDescription?: string
  ChannelStatus?: string
  ChannelStatusDescription?: string
  SupplierStatus?: string
  RetryCount?: number
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number // DynamoDB expiration time (UNIX timestamp)
}

/**
 * The full record stored in the Notifications table.
 */
export interface LastNotificationStateType extends NotificationUpdate {
  // normal convention is camelCase, however preserving as we already have records in DynamoDB
  NHSNumber: string
  ODSCode: string
  RequestId: string // x-request-id header
  SQSMessageID?: string // The SQS message ID
  NotifyMessageID?: string // The UUID we got back from Notify for the submitted message
  NotifyMessageReference: string // The references we generated for the message
  NotifyMessageBatchReference?: string // As above
  LastNotifiedPrescriptionStatus: string
}

export interface PSUDataItemWithPrevious {
  current: PSUDataItem;
  previous: PSUDataItem | undefined;
}
