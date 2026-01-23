import {Logger} from "@aws-lambda-powertools/logger"

import {processMessage} from "./businessLogic"
import {enrichMessagesWithExistingRecords} from "./databaseClient"
import {receivePostDatedSQSMessages, reportQueueStatus, handleProcessedMessages} from "./sqs"
import {BatchProcessingResult, PostDatedSQSMessage} from "./types"

const MAX_QUEUE_RUNTIME = 14 * 60 * 1000 // 14 minutes, to avoid Lambda timeout issues (timeout is 15 minutes)
const MIN_RECEIVED_THRESHOLD = 3 // If fewer than this number of messages are received, consider the queue empty

/**
 * Process a batch of SQS messages.
 * Messages are enriched with existing records from DynamoDB and processed individually.
 * Results are tracked for success/failure handling.
 *
 * @param messages - Array of messages to process
 * @param logger - Logger instance
 * @returns Object containing arrays of successful and failed messages
 */
export async function processMessages(
  messages: Array<PostDatedSQSMessage>,
  logger: Logger
): Promise<BatchProcessingResult> {
  if (messages.length === 0) {
    logger.info("No messages to process in batch")
    return {maturedPrescriptionUpdates: [], immaturePrescriptionUpdates: []}
  }

  // Enrich messages with existing records from DynamoDB
  const enrichedMessages = await enrichMessagesWithExistingRecords(messages, logger)

  const maturedPrescriptionUpdates: Array<PostDatedSQSMessage> = []
  const immaturePrescriptionUpdates: Array<PostDatedSQSMessage> = []

  for (const message of enrichedMessages) {
    try {
      const success = await processMessage(logger, message)
      if (success) {
        maturedPrescriptionUpdates.push(message)
      } else {
        immaturePrescriptionUpdates.push(message)
      }
    } catch (error) {
      logger.error("Error processing message", {
        messageId: message.MessageId,
        error
      })
      immaturePrescriptionUpdates.push(message)
    }
  }

  logger.info("Batch processing complete", {
    totalMessages: messages.length,
    maturedPrescriptionUpdatesCount: maturedPrescriptionUpdates.length,
    immaturePrescriptionUpdatesCount: immaturePrescriptionUpdates.length
  })

  return {maturedPrescriptionUpdates, immaturePrescriptionUpdates}
}

/**
 * Drain the queue until empty or the MAX_QUEUE_RUNTIME has passed.
 * Messages are processed in batches of 10.
 *
 * @param logger - Logger instance
 */
export async function processPostDatedQueue(logger: Logger): Promise<void> {
  const start = Date.now()
  let empty = false

  while (!empty) {
    // Lambdas can only run for so long, so guard against that
    if (Date.now() - start >= MAX_QUEUE_RUNTIME) {
      logger.warn("processPostDatedQueue timed out; exiting before queue is empty. Will report queue status", {
        maxRuntimeMilliseconds: MAX_QUEUE_RUNTIME
      })
      reportQueueStatus(logger)
      break
    }

    const messages = await receivePostDatedSQSMessages(logger)

    // break condition
    if (messages.length < MIN_RECEIVED_THRESHOLD) {
      empty = true
      logger.info("Received fewer messages than minimum threshold; considering queue drained", {
        receivedMessageCount: messages.length,
        minimumThreshold: MIN_RECEIVED_THRESHOLD
      })
    }

    // Process messages for this batch
    const result = await processMessages(messages, logger)
    await handleProcessedMessages(result, logger)
  }
}
