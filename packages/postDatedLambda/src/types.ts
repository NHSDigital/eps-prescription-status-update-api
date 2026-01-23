import {Message} from "@aws-sdk/client-sqs"
import {PostDatedNotifyDataItem, PSUDataItem} from "@psu-common/commonTypes"

/**
 * Extended SQS message interface for post-dated prescription messages.
 * Contains the parsed prescription data from the message body.
 */
export interface PostDatedSQSMessage extends Message {
  prescriptionData: PostDatedNotifyDataItem
}

/**
 * Combines post-dated prescription data from SQS with any existing
 * records from the PrescriptionStatusUpdates DynamoDB table.
 */
export interface PostDatedPrescriptionWithExistingRecords {
  /** The post-dated prescription data from the SQS message */
  postDatedData: PostDatedNotifyDataItem
  /** Existing records from DynamoDB that match the prescription ID */
  existingRecords: Array<PSUDataItem>
}

/**
 * Extended SQS message interface that includes existing records from DynamoDB.
 * Used during processing to have access to both the SQS message and related database records.
 */
export interface PostDatedSQSMessageWithExistingRecords extends PostDatedSQSMessage {
  /** Existing records from DynamoDB that match the prescription ID */
  existingRecords: Array<PSUDataItem>
}

/**
 * Result of processing a batch of messages.
 */
export interface BatchProcessingResult {
  maturedPrescriptionUpdates: Array<PostDatedSQSMessage>
  immaturePrescriptionUpdates: Array<PostDatedSQSMessage>
}
