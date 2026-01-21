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

import {PostDatedSQSMessage, ReceivedPostDatedSQSResult} from "./types"

const sqs = new SQSClient({region: process.env.AWS_REGION})

/**
 * Get the SQS queue URL from environment variables.
 * Throws an error if not configured.
 */
function getQueueUrl(logger: Logger): string {
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
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10) and bundles them together.
 *
 * @param logger - The AWS logging object
 * @param maxTotal - The maximum number of messages to fetch. Guaranteed to be less than this.
 * @param small_batch_threshold - If a batch returns fewer than this number of messages, stop polling further.
 * @returns
 *  - messages: the array of parsed PostDatedSQSMessage
 *  - isEmpty: true if the last receive returned fewer than 5 messages (or none),
 *             indicating the queue is effectively drained.
 */
export async function receivePostDatedSQSMessages(
  logger: Logger,
  maxTotal = 10,
  small_batch_threshold = 5
): Promise<ReceivedPostDatedSQSResult> {
  // eslint-disable-next-line max-len
  // TODO: This is borrowed from the notify lambda, but here it is not necessary to process 100 messages at a time - 10 is enough. Consider refactoring this function away.
  const sqsUrl = getQueueUrl(logger)

  const allMessages: Array<PostDatedSQSMessage> = []
  let receivedSoFar = 0
  let isEmpty = false
  let pollingIteration = 0

  while (receivedSoFar < maxTotal) {
    pollingIteration = pollingIteration + 1

    const toFetch = Math.min(10, maxTotal - receivedSoFar)
    const receiveCmd = new ReceiveMessageCommand({
      QueueUrl: sqsUrl,
      MaxNumberOfMessages: toFetch,
      // Use long polling to avoid getting empty responses when the queue is small
      WaitTimeSeconds: 20,
      MessageAttributeNames: ["All"]
    })

    const {Messages} = await sqs.send(receiveCmd)

    // if the queue is now empty, then break the loop
    if (!Messages || Messages.length === 0) {
      isEmpty = true
      logger.info("No messages received; marking queue as empty", {pollingIteration})
      break
    }

    logger.info(
      "Received some messages from the post-dated queue. Parsing them...",
      {
        pollingIteration,
        MessageIDs: Messages.map((m) => m.MessageId)
      }
    )

    // Parse and validate messages
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

    allMessages.push(...parsedMessages)
    receivedSoFar += parsedMessages.length

    // if the last batch of messages was small, then break the loop
    // This is to prevent a slow-loris style breakdown if the queue has
    // barely enough messages to keep the processors alive
    if (Messages.length < small_batch_threshold) {
      isEmpty = true
      logger.info(
        "Received a small number of messages. Considering the queue drained.",
        {batchLength: Messages.length, small_batch_threshold, pollingIteration}
      )
      break
    }
  }

  logger.info(`In sum, retrieved ${allMessages.length} messages from post-dated SQS`,
    {MessageIDs: allMessages.map(el => el.MessageId)}
  )

  return {messages: allMessages, isEmpty}
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
}

/**
 * Return failed messages to the queue with a visibility timeout.
 * This makes the messages invisible for the specified duration before they can be processed again.
 *
 * @param logger - The logging object
 * @param messages - The messages that failed processing and should be returned to the queue
 * @param visibilityTimeoutSeconds - The time in seconds before messages become visible again (default: 300 = 5 minutes)
 */
export async function returnMessagesToQueue(
  logger: Logger,
  messages: Array<Message>,
  visibilityTimeoutSeconds = 300
): Promise<void> {
  if (messages.length === 0) {
    logger.info("No failed messages to return to queue")
    return
  }

  const sqsUrl = getQueueUrl(logger)

  const entries = messages.map((m) => ({
    Id: m.MessageId!,
    ReceiptHandle: m.ReceiptHandle!,
    VisibilityTimeout: visibilityTimeoutSeconds
  }))

  logger.info(
    `Returning messages to queue with ${visibilityTimeoutSeconds}s timeout`,
    {numberOfMessages: entries.length, messageIds: entries.map((e) => e.Id)}
  )

  const changeVisibilityCmd = new ChangeMessageVisibilityBatchCommand({
    QueueUrl: sqsUrl,
    Entries: entries
  })
  const result = await sqs.send(changeVisibilityCmd)

  if (result.Failed && result.Failed.length > 0) {
    logger.error("Some messages failed to have visibility changed in this batch", {failed: result.Failed})
  } else {
    logger.info("Successfully returned SQS messages to queue", {
      result: result,
      messageIds: entries.map((e) => e.Id)
    })
  }
}
