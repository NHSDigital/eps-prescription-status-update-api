import {Message} from "@aws-sdk/client-sqs"
import {PostDatedNotifyDataItem} from "@psu-common/commonTypes"

/**
 * Extended SQS message interface for post-dated prescription messages.
 * Contains the parsed prescription data from the message body.
 */
export interface PostDatedSQSMessage extends Message {
  prescriptionData: PostDatedNotifyDataItem
}

/**
 * Result of processing a batch of messages.
 */
export interface BatchProcessingResult {
  successful: Array<PostDatedSQSMessage>
  failed: Array<PostDatedSQSMessage>
}

/**
 * Result of draining the queue.
 */
export interface ReceivedPostDatedSQSResult {
  messages: Array<PostDatedSQSMessage>
  isEmpty: boolean
}
