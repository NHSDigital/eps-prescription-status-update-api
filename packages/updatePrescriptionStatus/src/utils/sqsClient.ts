import {Logger} from "@aws-lambda-powertools/logger"
import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"

import {createHmac} from "crypto"

import {DataItem} from "../updatePrescriptionStatus"

const sqsUrl: string | undefined = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
const sqsSalt: string = process.env.SQS_SALT ?? "DEVSALT"

// The AWS_REGION is always defined in lambda environments
const sqs = new SQSClient({region: process.env.AWS_REGION})

/**
 * Returns the original array, chunked in batches of up to <size>
 *
 * @param arr - Array to be chunked
 * @param size - The maximum size of each chunk. The final chunk may be smaller.
 */
function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Salts and hashes a string.
 *
 * @param input - The string to be hashed
 * @param hashFunction - Which hash function to use. HMAC compatible. Defaults to SHA-256
 * @returns - A hex encoded string of the hash
 */
export function saltyHash(input: string, hashFunction: string = "sha256"): string {
  return createHmac(hashFunction, sqsSalt)
    .update(input, "utf8")
    .digest("hex")
}

/**
 * Pushes an array of DataItems to the notifications SQS queue
 * Uses SendMessageBatch to send up to 10 at a time
 *
 * @param requestId - The x-request-id header from the incoming event
 * @param data - Array of DataItems to send to SQS
 * @param logger - Logger instance
 */
export async function pushPrescriptionToNotificationSQS(
  requestId: string,
  data: Array<DataItem>,
  logger: Logger
) {
  logger.info("Pushing data items up to the notifications SQS", {count: data.length, sqsUrl})

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
      .filter((item) => updateStatuses.includes(item.Status))
      // Add the request ID to the SQS message
      .map((item) => ({...item, requestId}))
      // Build SQS batch entries with FIFO parameters
      .map((item, idx) => ({
        Id: idx.toString(),
        MessageBody: JSON.stringify(item),
        MessageGroupId: requestId,
        MessageDeduplicationId: saltyHash(item.PatientNHSNumber) // dedupe on NHS number
      }))

    if (entries.length === 0) {
      // Carry on if we have no updates to make.
      continue
    }

    logger.info(
      "Notification required. Pushing prescriptions with deduplication IDs",
      {deduplicationIds: entries.map(e => e.MessageDeduplicationId), requestId}
    )

    try {
      const command = new SendMessageBatchCommand({
        QueueUrl: sqsUrl,
        Entries: entries
      })
      const result = await sqs.send(command)
      if (result.Successful) {
        logger.info("Successfully sent a batch of prescriptions to the notifications SQS", {result})
      }
      // Some may succeed, and some may fail. So check for both
      if (result.Failed) {
        logger.error("Failed to send a batch of prescriptions to the notifications SQS", {result})
      }
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the notifications SQS", {error})
      throw error
    }
  }
}
