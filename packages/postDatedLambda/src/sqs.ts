import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityBatchCommand,
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"
import {Logger} from "@aws-lambda-powertools/logger"

import {PostDatedNotifyDataItem, SQSBatchMessage} from "@psu-common/commonTypes"

import {BatchProcessingResult, PostDatedSQSMessage} from "./types"

const sqs = new SQSClient({region: process.env.AWS_REGION})

// Note that a lot of the code to send an SQS message is copied from the updatePrescriptionStatus lambda,
// and I've NOT moved the code into a shared location for the two.
// This is because I don't want to alter the updatePrescriptionStatus lambda in that way
// for the sake of temporarily supporting post-dated messages.
//   - Jim Wild, Jan. 2026

function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function buildNotificationBatchEntries(
  messages: Array<PostDatedSQSMessage>,
  logger: Logger
): Array<SQSBatchMessage> {
  return messages.map((message, idx) => {
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
      Id: idx.toString(),
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
  })
}

async function sendEntriesToQueue(
  entries: Array<SQSBatchMessage>,
  queueUrl: string,
  logger: Logger
): Promise<Array<string>> {
  if (entries.length === 0) {
    return []
  }

  const batches = chunkArray(entries, 10)

  const batchPromises = batches.map(async (batch) => {
    try {
      logger.info(
        "Pushing a batch of notification requests to SQS",
        {
          batchLength: batch.length,
          deduplicationIds: batch.map((entry) => entry.MessageDeduplicationId),
          queueUrl
        }
      )

      const command = new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch
      })
      const result = await sqs.send(command)

      let successfulIds: Array<string> = []
      if (result.Successful?.length) {
        logger.info("Successfully sent a batch of prescriptions to the SQS", {result, queueUrl})
        successfulIds = result.Successful
          .map((entry) => entry.MessageId)
          .filter((msgId): msgId is string => msgId !== undefined)
      }

      if (result.Failed?.length) {
        throw new Error(`Failed to send a batch of prescriptions to the SQS ${queueUrl}`)
      }

      return successfulIds
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the SQS", {error, queueUrl})
      throw error
    }
  })

  return Promise.all(batchPromises).then((results) => results.flat())
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
      const parsedBody: PostDatedNotifyDataItem = JSON.parse(m.Body)
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
export async function sendSQSMessagesToNotificationQueue(
  logger: Logger,
  messages: Array<PostDatedSQSMessage>
): Promise<Array<string>> {
  if (messages.length === 0) {
    logger.info("No matured post-dated messages to forward to notifications queue")
    return []
  }

  const queueUrl = getNotificationQueueUrl(logger)
  const entries = buildNotificationBatchEntries(messages, logger)

  const sentMessageIds = await sendEntriesToQueue(entries, queueUrl, logger)

  logger.info("Forwarded matured post-dated messages to notifications queue", {
    queueUrl,
    forwardedCount: sentMessageIds.length,
    sqsMessageIds: sentMessageIds
  })

  return sentMessageIds
}

/**
 * Delete successfully processed messages from the SQS queue.
 *
 * @param logger - The logging object
 * @param messages - The messages that were successfully processed and should be deleted
 */
export async function removeSQSMessages(
  logger: Logger,
  messages: Array<Message>
): Promise<void> {
  if (messages.length === 0) {
    logger.info("No messages to delete")
    return
  }

  const sqsUrl = getPostDatedQueueUrl(logger)

  const entries = messages.map((m) => ({
    Id: m.MessageId!,
    ReceiptHandle: m.ReceiptHandle!
  }))

  logger.info("Deleting messages from SQS", {
    numberOfMessages: entries.length,
    messageIds: entries.map((e) => e.Id)
  })

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
export async function returnMessagesToQueue(
  logger: Logger,
  messages: Array<Message>
): Promise<void> {
  if (messages.length === 0) {
    logger.info("No messages to return to queue")
    return
  }

  const sqsUrl = getPostDatedQueueUrl(logger)

  // TODO: Each message needs to have an appropriate visibility timeout based on when it is due to be retried.
  // For now, use a fixed 5 minute timeout for all messages.
  const visibilityTimeoutSeconds = 300
  const entries = messages.map((m) => ({
    Id: m.MessageId!,
    ReceiptHandle: m.ReceiptHandle!,
    VisibilityTimeout: visibilityTimeoutSeconds
  }))

  logger.info(
    `Returning messages to queue with timeouts`,
    {
      numberOfMessages: entries.length,
      idAndTimeouts: entries.map((e) => ({id: e.Id, visibilityTimeout: e.VisibilityTimeout}))
    }
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

/**
 * Handle the results of message processing:
 * - Delete matured messages from the queue
 * - Return immature messages to the queue with a visibility timeout
 * Does not alter the input result object, only performs side effects.
 *
 * @param result - The batch processing result
 * @param logger - The logging object
 */
export async function handleProcessedMessages(
  result: BatchProcessingResult,
  logger: Logger
): Promise<void> {
  const {maturedPrescriptionUpdates, immaturePrescriptionUpdates} = result

  // Move matured messages to the notification queue and remove them from the post-dated queue
  if (maturedPrescriptionUpdates.length > 0) {
    await sendSQSMessagesToNotificationQueue(logger, maturedPrescriptionUpdates)
    await removeSQSMessages(logger, maturedPrescriptionUpdates)
  }

  // Return failed messages to the queue
  if (immaturePrescriptionUpdates.length > 0) {
    await returnMessagesToQueue(logger, immaturePrescriptionUpdates)
  }
}
