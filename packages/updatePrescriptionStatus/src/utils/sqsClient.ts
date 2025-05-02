import {Logger} from "@aws-lambda-powertools/logger"
import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"

import {createHmac} from "crypto"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {checkSiteOrSystemIsNotifyEnabled} from "../validation/notificationSiteAndSystemFilters"

const sqsUrl: string | undefined = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
const fallbackSalt = "DEV SALT"
const sqsSalt: string = process.env.SQS_SALT ?? fallbackSalt

// The AWS_REGION is always defined in lambda environments
const sqs = new SQSClient({region: process.env.AWS_REGION})

/**
 * Returns the original array, chunked in batches of up to <size>
 *
 * @param arr - Array to be chunked
 * @param size - The maximum size of each chunk. The final chunk may be smaller.
 * @returns - an (N+1) dimensional array
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
export function saltedHash(logger: Logger, input: string, hashFunction: string = "sha256"): string {
  if (sqsSalt === fallbackSalt) {
    logger.warn("Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value.")
  }
  return createHmac(hashFunction, sqsSalt)
    .update(input, "utf8")
    .digest("hex")
}

/**
 * Pushes an array of PSUDataItem to the notifications SQS queue
 * Uses SendMessageBatch to send up to 10 at a time
 *
 * @param requestId - The x-request-id header from the incoming event
 * @param data - Array of PSUDataItem to send to SQS
 * @param logger - Logger instance
 */
export async function pushPrescriptionToNotificationSQS(
  requestId: string,
  data: Array<PSUDataItem>,
  logger: Logger
) {
  logger.info("Checking if any items require notifications", {numItemsToBeChecked: data.length, sqsUrl})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  // Only allow through sites and systems that are allowedSitesAndSystems
  const allowedSitesAndSystemsData = checkSiteOrSystemIsNotifyEnabled(data)
  logger.info(
    "Filtered out sites and suppliers that are not enabled, or are explicitly disabled",
    {
      numItemsAllowed: allowedSitesAndSystemsData.length
    }
  )

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(allowedSitesAndSystemsData, 10)

  // Only these statuses will be pushed to the SQS
  const updateStatuses: Array<string> = [
    "ready to collect",
    "ready to collect - partial"
  ]

  for (const batch of batches) {
    const entries = batch
      .filter((item) => updateStatuses.includes(item.Status.toLowerCase()))
      // Build SQS batch entries with FIFO parameters
      .map((item, idx) => ({
        Id: idx.toString(),
        MessageBody: JSON.stringify(item),
        // FIFO
        // We dedupe on both nhs number and ods code
        MessageDeduplicationId: saltedHash(logger, `${item.PatientNHSNumber}:${item.PharmacyODSCode}`),
        MessageGroupId: requestId,
        MessageAttributes: {
          RequestId: {
            DataType: "String",
            StringValue: requestId
          }
        }
      }))
    // We could do a round of deduplications here, but benefits would be minimal and AWS SQS will do it for us anyway.

    if (!entries.length) {
      // Carry on if we have no updates to make.
      logger.info("No entries to post to the notifications SQS")
      continue
    }

    logger.info(
      "Notification required. Pushing prescriptions to the notifications SQS with the following SQS message IDs",
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
