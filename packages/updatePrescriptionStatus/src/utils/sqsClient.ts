import {Logger} from "@aws-lambda-powertools/logger"
import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"

import {v4} from "uuid"

import {DataItem} from "../updatePrescriptionStatus"

const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

// The AWS_REGION is always defined in lambda environments
const sqs = new SQSClient({region: process.env.AWS_REGION})

// Returns the original array, chunked in batches of up to <size>
function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Pushes an array of DataItems to the notifications SQS queue
 * Uses SendMessageBatch to send up to 10 at a time
 *
 * @param data - Array of DataItems to send to SQS
 * @param logger - Logger instance
 */
export async function pushPrescriptionToNotificationSQS(requestId: string, data: Array<DataItem>, logger: Logger) {
  logger.info("Checking if any items require notifications", {numItemsToBeChecked: data.length, sqsUrl})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(data, 10)

  // Only these statuses will be pushed to the SQS
  const updateStatuses: Array<string> = [
    "ready to collect",
    "ready to collect - partial"
  ]

  for (const batch of batches) {
    const entries = batch
      .filter((item) => updateStatuses.includes(item.Status.toLowerCase()))
      // Add the request ID to the SQS message
      .map((item) => ({...item, requestId}))
      .map((item) => ({Id: v4().toUpperCase(), MessageBody: JSON.stringify(item)}))

    if (!entries.length) {
      // Carry on if we have no updates to make.
      continue
    }

    const params = {
      QueueUrl: sqsUrl,
      Entries: entries
    }

    const messageIds = entries.map((el) => el.Id)
    logger.info(
      "Notification required. Pushing prescriptions to the notifications SQS with the following SQS message IDs",
      {messageIds, requestId}
    )

    try {
      const command = new SendMessageBatchCommand(params)
      const result = await sqs.send(command)
      if (result.Successful) {
        logger.info("Successfully sent a batch of prescriptions to the notifications SQS", {result})
      } else {
        logger.error("Failed to send a batch of prescriptions to the notifications SQS", {result})
        throw new Error("Failed to send a batch of prescriptions to the notifications SQS")
      }
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the notifications SQS", {error})
      throw error
    }
  }
}
