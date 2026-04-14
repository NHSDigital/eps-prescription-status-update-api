import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityBatchCommand,
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  Message
} from "@aws-sdk/client-sqs"
import {Logger} from "@aws-lambda-powertools/logger"

import {NotifyDataItem} from "@psu-common/commonTypes"

import {PostDatedSQSMessage} from "./types"

const sqs = new SQSClient({region: process.env.AWS_REGION})

const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300 // 5 minutes
const MAXIMUM_VISIBILITY_TIMEOUT_SECONDS = 10 * 60 * 60 // 10 hours

// Note that a lot of the code to send an SQS message is copied from the updatePrescriptionStatus lambda,
// and I've NOT moved the code into a shared location for the two.
// This is because I don't want to alter the updatePrescriptionStatus lambda in that way
// for the sake of temporarily supporting post-dated messages.
//   - Jim Wild, Jan. 2026

function buildNotificationBatchEntry(
  message: PostDatedSQSMessage,
  logger: Logger
): SendMessageBatchRequestEntry {
  const {prescriptionData} = message

  // If we get something with no deduplication ID, then something upstream is wrong and we should fail out
  if (!message.Attributes?.MessageDeduplicationId) {
    logger.error("Post-dated SQS message is missing MessageDeduplicationId attribute", {
      messageId: message.MessageId, messageContents: message
    })
    throw new Error("Missing MessageDeduplicationId in SQS message attributes")
  }
  // Same for group ID
  if (!message.Attributes?.MessageGroupId) {
    logger.error("Post-dated SQS message is missing MessageGroupId attribute", {
      messageId: message.MessageId, messageContents: message
    })
    throw new Error("Missing MessageGroupId in SQS message attributes")
  }

  return {
    Id: message.MessageId!,
    MessageBody: JSON.stringify(prescriptionData),
    MessageDeduplicationId: message.Attributes?.MessageDeduplicationId,
    MessageGroupId: message.Attributes?.MessageGroupId,
    MessageAttributes: {
      RequestId: {
        DataType: "String",
        StringValue: message.Attributes?.MessageGroupId
      }
    }
  }
}

/** Send an entry to an SQS queue. Returns the message ID if successful, throw otherwise */
async function sendEntryToQueue(
  entry: SendMessageBatchRequestEntry,
  queueUrl: string,
  logger: Logger
): Promise<string> {

  logger.info(
    "Pushing a notification request to SQS",
    {
      deduplicationId: entry.MessageDeduplicationId,
      queueUrl
    }
  )

  const command = new SendMessageBatchCommand({
    QueueUrl: queueUrl,
    Entries: [entry]
  })
  const result = await sqs.send(command)

  if (result.Failed && result.Failed.length > 0) {
    logger.error("Failed to send message to notification queue", {failed: result.Failed})
    throw new Error(`Failed to send message to notification queue: ${JSON.stringify(result.Failed)}`)
  }

  // It may be that the send was successful but we didn't get a message ID back,
  // which shouldn't happen but if it does we should catch it and log an error rather than returning undefined
  const sentMessageId = result.Successful?.[0].MessageId
  if (!sentMessageId) {
    logger.error("No message ID returned from SQS for successful send", {result})
    throw new Error("No message ID returned from SQS for successful send")
  }

  logger.info("Successfully sent message to notification queue", {sentMessageId})
  return sentMessageId
}

/**
 * Get the SQS queue URL from environment variables.
 * Throws an error if not configured.
 */
export function getPostDatedQueueUrl(logger: Logger): string {
  const sqsUrl = process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL
  if (!sqsUrl) {
    logger.error("Post-dated prescriptions SQS URL not configured")
    throw new Error("POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }
  return sqsUrl
}

export function getNotificationQueueUrl(logger: Logger): string {
  const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
  if (!sqsUrl) {
    logger.error("NHS Notify prescriptions SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }
  return sqsUrl
}

/**
 * Report the current status of the post-dated prescriptions SQS queue.
 *
 * @param logger - The AWS logging object
 */
export async function reportQueueStatus(logger: Logger): Promise<void> {
  const sqsUrl = getPostDatedQueueUrl(logger)

  const attrsCmd = new GetQueueAttributesCommand({
    QueueUrl: sqsUrl,
    AttributeNames: [
      "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible",
      "ApproximateNumberOfMessagesDelayed"
    ]
  })
  const {Attributes} = await sqs.send(attrsCmd)

  // Fall back to a negative value so missing data can be identified
  const ApproximateNumberOfMessages = Number.parseInt(Attributes?.ApproximateNumberOfMessages ?? "-1")
  const ApproximateNumberOfMessagesNotVisible = Number.parseInt(
    Attributes?.ApproximateNumberOfMessagesNotVisible ?? "-1"
  )
  const ApproximateNumberOfMessagesDelayed = Number.parseInt(Attributes?.ApproximateNumberOfMessagesDelayed ?? "-1")

  logger.info(
    "Current post-dated queue attributes (if a value failed to fetch, it will be reported as -1):",
    {
      ApproximateNumberOfMessages,
      ApproximateNumberOfMessagesNotVisible,
      ApproximateNumberOfMessagesDelayed
    }
  )
}

/**
 * Pulls up to 10 messages from SQS.
 *
 * @param logger - The AWS logging object
 * @returns - The array of parsed PostDatedSQSMessage
 */
export async function receivePostDatedSQSMessages(logger: Logger): Promise<Array<PostDatedSQSMessage>> {
  const sqsUrl = getPostDatedQueueUrl(logger)
  const toFetch = 10

  const receiveCmd = new ReceiveMessageCommand({
    QueueUrl: sqsUrl,
    MaxNumberOfMessages: toFetch,
    // Use long polling to avoid getting empty responses when the queue is small
    WaitTimeSeconds: 20,
    MessageAttributeNames: ["All"],
    MessageSystemAttributeNames: ["MessageDeduplicationId", "MessageGroupId"]
  })

  const {Messages} = await sqs.send(receiveCmd)

  if (!Messages || Messages.length === 0) {
    logger.info("No messages received; marking queue as empty")
    return []
  }

  logger.info("Received some messages from the post-dated queue. Parsing them...", {
    MessageIDs: Messages.map((m) => m.MessageId)
  })

  const parsedMessages: Array<PostDatedSQSMessage> = Messages.flatMap((m) => {
    if (!m.Body) {
      logger.error(
        "Received an invalid SQS message (missing Body) - omitting from processing.",
        {offendingMessage: m}
      )
      return []
    }
    try {
      const parsedBody: NotifyDataItem = JSON.parse(m.Body)
      return [
        {
          ...m,
          prescriptionData: parsedBody
        }
      ]
    } catch (error) {
      logger.error(
        "Failed to parse SQS message body as JSON - omitting from processing.",
        {offendingMessage: m, parseError: error}
      )
      return []
    }
  })

  logger.info(`In sum, retrieved ${parsedMessages.length} messages from post-dated SQS`, {
    MessageIDs: parsedMessages.map((el) => el.MessageId)
  })

  return parsedMessages
}

/**
 * Forward matured post-dated messages to the Notify queue using the same payload as the update lambda.
 */
export async function forwardSQSMessageToNotificationQueue(
  logger: Logger,
  message: PostDatedSQSMessage
): Promise<string> {
  const queueUrl = getNotificationQueueUrl(logger)
  const entry = buildNotificationBatchEntry(message, logger)

  return sendEntryToQueue(entry, queueUrl, logger)
}

/**
 * Delete successfully processed message from the SQS queue.
 *
 * @param logger - The logging object
 * @param message - The message that should be deleted
 */
export async function removeSQSMessage(
  logger: Logger,
  message: Message
): Promise<void> {
  const sqsUrl = getPostDatedQueueUrl(logger)

  const entries = [{
    Id: message.MessageId!,
    ReceiptHandle: message.ReceiptHandle!
  }]

  const deleteCmd = new DeleteMessageBatchCommand({
    QueueUrl: sqsUrl,
    Entries: entries
  })
  const delResult = await sqs.send(deleteCmd)

  if (delResult.Failed && delResult.Failed.length > 0) {
    logger.error("Some messages failed to delete", {failed: delResult.Failed})
  } else {
    logger.info("Successfully deleted SQS messages", {
      result: delResult,
      messageIds: entries.map((e) => e.Id)
    })
  }

  logger.info(`Successfully removed ${delResult.Successful?.length ?? 0} messages from SQS`)
}

/**
 * Edit failed that are on the queue to update their visibility timeout.
 * This makes the messages invisible for the specified duration before they can be processed again.
 * This does not delete the messages, or post new ones; it only alters their visibility.
 *
 * @param logger - The logging object
 * @param messages - The messages that failed processing and should be returned to the queue
 */
export async function returnMessageToQueue(
  logger: Logger,
  message: PostDatedSQSMessage
): Promise<void> {
  const sqsUrl = getPostDatedQueueUrl(logger)

  const timeout = Math.max(0, Math.min( // greater than 0
    message.visibilityTimeoutSeconds || DEFAULT_VISIBILITY_TIMEOUT_SECONDS, // fallback
    MAXIMUM_VISIBILITY_TIMEOUT_SECONDS // limit
  ))

  const entries = [{
    Id: message.MessageId!,
    ReceiptHandle: message.ReceiptHandle!,
    VisibilityTimeout: timeout
  }]

  logger.info(
    `Returning message to queue with timeouts`,
    {sqsMessage: message, visibilityTimeout: timeout}
  )

  const changeVisibilityCmd = new ChangeMessageVisibilityBatchCommand({
    QueueUrl: sqsUrl,
    Entries: entries
  })

  try {
    const result = await sqs.send(changeVisibilityCmd)

    if (result.Failed && result.Failed.length > 0) {
      logger.error("Some messages failed to have visibility changed in this batch", {failed: result.Failed})
    } else {
      logger.info("Successfully returned SQS messages to queue", {
        result: result,
        messageIds: entries.map((e) => e.Id)
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to change SQS message visibility"
    logger.error(message, {error})
  }
}
