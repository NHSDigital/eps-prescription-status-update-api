import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message,
  GetQueueAttributesCommand
} from "@aws-sdk/client-sqs"
import {Logger} from "@aws-lambda-powertools/logger"

import {v4} from "uuid"

import {NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {NotifyDataItemMessage} from "./types"
import {chunkArray} from "./notify"

const sqs = new SQSClient({region: process.env.AWS_REGION})
const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

export async function reportQueueStatus(logger: Logger): Promise<void> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

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
  const ApproximateNumberOfMessages = parseInt(Attributes?.ApproximateNumberOfMessages ?? "-1")
  const ApproximateNumberOfMessagesNotVisible = parseInt(Attributes?.ApproximateNumberOfMessagesNotVisible ?? "-1")
  const ApproximateNumberOfMessagesDelayed = parseInt(Attributes?.ApproximateNumberOfMessagesDelayed ?? "-1")

  logger.info(
    "Current queue attributes (if a value failed to fetch, it will be reported as -1):",
    {
      ApproximateNumberOfMessages,
      ApproximateNumberOfMessagesNotVisible,
      ApproximateNumberOfMessagesDelayed
    }
  )
}

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10) and bundles them together.
 * @param logger - The AWS logging object
 * @param maxTotal - The maximum number of messages to fetch. Guaranteed to be less than this.
 * @returns
 *  - messages the array of parsed NotifyDataItemMessage
 *  - isEmpty: true if the last receive returned fewer than 5 messages (or none),
 *             indicating the queue is effectively drained.
*/
export async function drainQueue(
  logger: Logger,
  maxTotal = 100
): Promise<{ messages: Array<NotifyDataItemMessage>; isEmpty: boolean }> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  const allMessages: Array<NotifyDataItemMessage> = []
  const seenDeduplicationIds = new Set<string>()
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
      // If the queue is large enough to easily supply the requested number of messages,
      // the fetch does not wait the whole 20 seconds, so this is not a bottleneck for high
      // traffic periods.
      WaitTimeSeconds: 20,
      MessageSystemAttributeNames: ["MessageDeduplicationId"],
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
      "Received some messages from the queue. Parsing them...",
      {
        pollingIteration,
        MessageIDs: Messages.map((m) => m.MessageId)
      }
    )

    // flatmap causes the [] to be filtered out, since nothing is there to be flattened
    const parsedMessages: Array<NotifyDataItemMessage> = Messages.flatMap((m) => {
      if (!m.Body) {
        logger.error(
          "Received an invalid SQS message (missing Body) - omitting from processing.",
          {offendingMessage: m}
        )
        return []
      }
      try {
        const parsedBody: NotifyDataItem = JSON.parse(m.Body)
        // This is an array of one element, which will be extracted by the flatmap
        return [
          {
            ...m,
            PSUDataItem: parsedBody,
            messageBatchReference: undefined, // Only populated when notify request is made
            messageReference: v4()
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

    // Ensure each message has a unique, populated deduplication ID
    // Where two messages have the same deduplication ID (i.e. they have the same
    // NHS number and ODS code), only keep the first one.
    // Note that this may happen for cases where the queue is not processed for over 5
    // minutes, and two updates are submitted for a patient after that time has passed.
    const uniqueMessages: Array<NotifyDataItemMessage> = []
    for (const msg of parsedMessages) {
      const dedupId = msg.Attributes?.MessageDeduplicationId
      if (!dedupId) {
        logger.error("SQS message missing MessageDeduplicationId. Skipping this message",
          {messageId: msg.MessageId, badMessage: msg})
        continue
      }
      if (seenDeduplicationIds.has(dedupId)) {
        logger.warn("Duplicate MessageDeduplicationId encountered; skipping duplicate",
          {messageId: msg.MessageId, deduplicationId: dedupId})
        continue
      }
      seenDeduplicationIds.add(dedupId)
      uniqueMessages.push(msg)
    }
    allMessages.push(...uniqueMessages)
    receivedSoFar += uniqueMessages.length

    // if the last batch of messages was small, then break the loop
    // This is to prevent a slow-loris style breakdown if the queue has
    // barely enough messages to keep the processors alive
    if (!Messages || Messages.length < 5) {
      isEmpty = true
      logger.info("Received a small number of messages. Considering the queue drained.", {batchLength: Messages.length})
      break
    }
  }

  logger.info(`In sum, retrieved ${allMessages.length} messages from SQS`,
    {MessageDeduplicationIds: allMessages.map(el => el.Attributes?.MessageDeduplicationId)}
  )

  return {messages: allMessages, isEmpty}
}

/**
 * For each message given, delete it from the notifications SQS in batches of up to 10.
 * If a batch fails to delete, the error is logged but execution continues.
 *
 * @param logger - the logging object
 * @param messages - The messages that were received from SQS, and are to be deleted.
 */
export async function removeSQSMessages(
  logger: Logger,
  messages: Array<Message>
): Promise<void> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  const batches = chunkArray(messages, 10)

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]
    const entries = batch.map((m) => ({
      Id: m.MessageId!,
      ReceiptHandle: m.ReceiptHandle!
    }))

    logger.info(`Deleting batch ${batchIndex + 1}/${batches.length}`, {
      batchSize: entries.length,
      messageIds: entries.map((e) => e.Id)
    })

    const deleteCmd = new DeleteMessageBatchCommand({
      QueueUrl: sqsUrl,
      Entries: entries
    })
    const delResult = await sqs.send(deleteCmd)

    if (delResult.Failed && delResult.Failed.length > 0) {
      logger.error("Some messages failed to delete in this batch", {failed: delResult.Failed})
    } else {
      logger.info(`Successfully deleted SQS message batch ${batchIndex + 1}`, {
        result: delResult,
        messageIds: entries.map((e) => e.Id)
      })
    }
  }
}
