import {Logger} from "@aws-lambda-powertools/logger"

import {processMessage} from "./businessLogic"
import {
  removeSQSMessages,
  returnMessagesToQueue,
  receivePostDatedSQSMessages,
  reportQueueStatus
} from "./sqs"
import {BatchProcessingResult, PostDatedSQSMessage} from "./types"

const MAX_QUEUE_RUNTIME = 14 * 60 * 1000 // 14 minutes, to avoid Lambda timeout issues (timeout is 15 minutes)
const BATCH_SIZE = 10
const FAILED_MESSAGE_VISIBILITY_TIMEOUT = 300 // 5 minutes in seconds

/**
 * Process a batch of SQS messages.
 * Messages are processed individually, and results are tracked for success/failure handling.
 *
 * @param messages - Array of messages to process
 * @returns Object containing arrays of successful and failed messages
 */
export async function processMessages(
  messages: Array<PostDatedSQSMessage>,
  logger: Logger
): Promise<BatchProcessingResult> {
  if (messages.length === 0) {
    logger.info("No messages to process in batch")
    return {successful: [], failed: []}
  }

  const successful: Array<PostDatedSQSMessage> = []
  const failed: Array<PostDatedSQSMessage> = []

  for (const message of messages) {
    try {
      const success = await processMessage(logger, message)
      if (success) {
        successful.push(message)
      } else {
        failed.push(message)
      }
    } catch (error) {
      logger.error("Error processing message", {
        messageId: message.MessageId,
        error
      })
      failed.push(message)
    }
  }

  logger.info("Batch processing complete", {
    totalMessages: messages.length,
    successfulCount: successful.length,
    failedCount: failed.length
  })

  return {successful, failed}
}

/**
 * Handle the results of message processing:
 * - Delete successful messages from the queue
 * - Return failed messages to the queue with a visibility timeout
 * Does not alter the input result object, only performs side effects.
 *
 * @param result - The batch processing result
 */
export async function handleProcessedMessages(
  result: BatchProcessingResult,
  logger: Logger
): Promise<void> {
  const {successful, failed} = result

  // Delete successful messages
  if (successful.length > 0) {
    await removeSQSMessages(logger, successful)
  }

  // Return failed messages to the queue with a 5 minute timeout
  if (failed.length > 0) {
    await returnMessagesToQueue(logger, failed, FAILED_MESSAGE_VISIBILITY_TIMEOUT)
  }
}

/**
 * Drain the queue until empty or the MAX_QUEUE_RUNTIME has passed.
 * Messages are processed in batches of 10.
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

    const {messages, isEmpty} = await receivePostDatedSQSMessages(logger, BATCH_SIZE)
    empty = isEmpty

    if (messages.length === 0) {
      logger.info("No messages retrieved from queue")
      continue
    }

    // Process messages for this batch
    const result = await processMessages(messages, logger)
    return await handleProcessedMessages(result, logger)
  }
}
