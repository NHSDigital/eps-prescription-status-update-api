import {Message} from "@aws-sdk/client-sqs"
import {NotifyDataItem, PSUDataItem} from "@psu-common/commonTypes"

/**
 * Extended SQS message interface for post-dated prescription messages.
 * Contains the parsed prescription data from the message body.
 */
export interface PostDatedSQSMessage extends Message {
  prescriptionData: NotifyDataItem
  visibilityTimeoutSeconds?: number
}

/**
 * Combines post-dated prescription data from SQS with any existing
 * records from the PrescriptionStatusUpdates DynamoDB table.
 */
export interface PostDatedPrescriptionWithRecentDataItem {
  /** The post-dated prescription data from the SQS message */
  postDatedData: NotifyDataItem
  /** The most recently submitted PSU data item for this prescription ID */
  mostRecentRecord?: PSUDataItem
}

/**
 * Extended SQS message interface that includes existing records from DynamoDB.
 * Used during processing to have access to both the SQS message and related database records.
 */
export interface PostDatedSQSMessageWithRecentDataItem extends PostDatedSQSMessage {
  /** The most recently submitted PSU data item for this prescription ID */
  mostRecentRecord?: PSUDataItem
}

export enum PostDatedProcessingResult {
  FORWARD_TO_NOTIFICATIONS = "forward_to_notifications",
  REPROCESS = "reprocess",
  REMOVE_FROM_PD_QUEUE = "remove_from_pd_queue"
}
