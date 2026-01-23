import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityBatchCommand,
  GetQueueAttributesCommand,
  Message
} from "@aws-sdk/client-sqs"
import {Logger} from "@aws-lambda-powertools/logger"

import {PostDatedNotifyDataItem} from "@psu-common/commonTypes"

import {BatchProcessingResult, PostDatedSQSMessage} from "./types"

const sqs = new SQSClient({region: process.env.AWS_REGION})

/**
 * Get the SQS queue URL from environment variables.
 * Throws an error if not configured.
 */
export function getQueueUrl(logger: Logger): string {
  const sqsUrl = process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL
  if (!sqsUrl) {
    logger.error("Post-dated prescriptions SQS URL not configured")
    throw new Error("POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }
  return sqsUrl
}

/**
 * Report the current status of the post-dated prescriptions SQS queue.
 *
 * @param logger - The AWS logging object
 */
export async function reportQueueStatus(logger: Logger): Promise<void> {
  const sqsUrl = getQueueUrl(logger)

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
  const sqsUrl = getQueueUrl(logger)
  const toFetch = 10

  const receiveCmd = new ReceiveMessageCommand({
    QueueUrl: sqsUrl,
    MaxNumberOfMessages: toFetch,
    // Use long polling to avoid getting empty responses when the queue is small
    WaitTimeSeconds: 20,
    MessageAttributeNames: ["All"]
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

  const sqsUrl = getQueueUrl(logger)

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

  const sqsUrl = getQueueUrl(logger)

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

  // Delete matured messages
  if (maturedPrescriptionUpdates.length > 0) {
    // TODO: Also need to send messages to the notification queue here (do that first, then delete)
    // await sendSQSMessagesToNotificationQueue(logger, maturedPrescriptionUpdates)
    await removeSQSMessages(logger, maturedPrescriptionUpdates)
  }

  // Return failed messages to the queue
  if (immaturePrescriptionUpdates.length > 0) {
    await returnMessagesToQueue(logger, immaturePrescriptionUpdates)
  }
}
