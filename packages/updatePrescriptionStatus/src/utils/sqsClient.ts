import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"
import {v4} from "uuid"

import {Logger} from "@aws-lambda-powertools/logger"
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
export async function pushPrescriptionToNotificationSQS(data: Array<DataItem>, logger: Logger) {
  logger.info("Pushing data items up to the notifications SQS", {data, sqsUrl})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(data, 10)

  for (const batch of batches) {
    // Create SQS entries. Each message is required to have an unique Id string.
    // TODO: I'm creating a new UUID here, but am I safe to use the lineID? It looks like it should be unique
    const entries = batch.map((item) => ({
      Id: v4().toUpperCase(),
      // Id: item.LineItemID || v4().toUpperCase(),
      MessageBody: JSON.stringify(item)
    }))

    const params = {
      QueueUrl: sqsUrl,
      Entries: entries
    }

    try {
      const command = new SendMessageBatchCommand(params)
      const result = await sqs.send(command)
      logger.info("Successfully sent a batch of prescriptions to the notifications SQS", {result})
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the notifications SQS", {error})
      throw error
    }
  }
}
