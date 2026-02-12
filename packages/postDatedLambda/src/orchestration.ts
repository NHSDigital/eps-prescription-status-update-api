import {Logger} from "@aws-lambda-powertools/logger"

import {computeTimeUntilMaturity, determineAction} from "./businessLogic"
import {enrichMessagesWithMostRecentDataItem} from "./databaseClient"
import {
  receivePostDatedSQSMessages,
  reportQueueStatus,
  forwardSQSMessageToNotificationQueue,
  removeSQSMessage,
  returnMessageToQueue
} from "./sqs"
import {PostDatedProcessingResult, PostDatedSQSMessage, PostDatedSQSMessageWithRecentDataItem} from "./types"

export const MAX_QUEUE_RUNTIME = 14 * 60 * 1000 // 14 minutes, to avoid Lambda timeout issues (timeout is 15 minutes)
const MIN_RECEIVED_THRESHOLD = 3 // If fewer than this number of messages are received, consider the queue empty

async function handleMaturedPrescription(
  logger: Logger,
  message: PostDatedSQSMessageWithRecentDataItem
): Promise<void> {
  await forwardSQSMessageToNotificationQueue(logger, message)
  await removeSQSMessage(logger, message)
}

async function handleImmaturePrescription(
  logger: Logger,
  message: PostDatedSQSMessageWithRecentDataItem
): Promise<void> {
  // Set visibility timeout to time until maturity, or default if calculation fails
  message.visibilityTimeoutSeconds = computeTimeUntilMaturity(message)
  await returnMessageToQueue(logger, message)
}

/**
 * Process a batch of SQS messages. Returns arrays of matured and immature prescription updates.
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
): Promise<void> {
  const enrichedMessages = await enrichMessagesWithMostRecentDataItem(messages, logger)

  // Build an array of promises to await in parallel
  const promises = []
  for (const message of enrichedMessages) {
    const action = determineAction(logger, message)

    switch (action) {
      case PostDatedProcessingResult.REPROCESS:
        promises.push(handleImmaturePrescription(logger, message))
        break
      case PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS:
        promises.push(handleMaturedPrescription(logger, message))
        break
      case PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE:
        promises.push(removeSQSMessage(logger, message))
        break
      default:
        logger.error("Unexpected processing result", {
          messageId: message.MessageId,
          action
        })
        throw new Error(`Unexpected processing result: ${action}`)
    }
  }

  await Promise.all(promises)
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
      await reportQueueStatus(logger)
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
    await processMessages(messages, logger)
  }
}
