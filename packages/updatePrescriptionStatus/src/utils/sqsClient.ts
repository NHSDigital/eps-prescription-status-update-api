import {Logger} from "@aws-lambda-powertools/logger"
import {DeleteMessageBatchCommand, SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {createHmac} from "crypto"

import {PSUDataItem, NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {checkSiteOrSystemIsNotifyEnabled} from "../validation/notificationSiteAndSystemFilters"

const sqsUrl: string | undefined = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
const fallbackSalt = "DEV SALT"

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
export function saltedHash(
  input: string,
  sqsSalt: string,
  hashFunction: string = "sha256"
): string {
  return createHmac(hashFunction, sqsSalt)
    .update(input, "utf8")
    .digest("hex")
}

/**
 * Gets the salt value from the secrets manager
 */
export async function getSaltValue(logger: Logger): Promise<string> {
  let sqsSalt: string

  if (!process.env.SQS_SALT) {
    // No secret name configured at all, so fall back
    sqsSalt = fallbackSalt
  } else {
    try {
      // grab the secret, expecting JSON like { "salt": "string" }
      const secretJson = await getSecret(process.env.SQS_SALT, {transform: "json"})

      // must be a non‐null object with a string .salt
      if (
        typeof secretJson === "object" &&
        secretJson !== null &&
        "salt" in secretJson &&
        typeof secretJson.salt === "string"
      ) {
        // OK
        sqsSalt = secretJson.salt
      } else {
        logger.error("Secret did not contain a valid salt field, falling back to DEV SALT", {
          secretValue: secretJson
        })
        sqsSalt = fallbackSalt
      }
    } catch (error) {
      logger.error("Failed to fetch SQS_SALT from Secrets Manager, using DEV SALT", {error})
      sqsSalt = fallbackSalt
    }
  }

  if (sqsSalt === fallbackSalt) {
    logger.warn(
      "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
    )
  }

  return sqsSalt
}

/**
 * Pushes an array of PSUDataItem to the notifications SQS queue
 * Uses SendMessageBatch to send up to 10 at a time
 *
 * @param requestId - The x-request-id header from the incoming event
 * @param data - Array of PSUDataItem to send to SQS
 * @param logger - Logger instance
 *
 * @returns An array of the created MessageIds
 */
export async function pushPrescriptionToNotificationSQS(
  requestId: string,
  data: Array<PSUDataItem>,
  logger: Logger
): Promise<Array<string>> {
  logger.info("Checking if any items require notifications", {numItemsToBeChecked: data.length, sqsUrl})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  // Only allow through sites and systems that are allowedSitesAndSystems
  const allowedSitesAndSystemsData = await checkSiteOrSystemIsNotifyEnabled(data)
  logger.info(
    "Filtered out sites and suppliers that are not enabled, or are explicitly disabled",
    {numItemsAllowed: allowedSitesAndSystemsData.length}
  )

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(allowedSitesAndSystemsData, 10)

  // Only these statuses will be pushed to the SQS
  const updateStatuses: Array<string> = [
    "ready to collect",
    "ready to collect - partial"
  ]

  // Used for the return value
  let out: Array<string> = []

  const sqsSalt = await getSaltValue(logger)

  for (const batch of batches) {
    const entries = batch
      .filter((item) => updateStatuses.includes(item.Status.toLowerCase()))
      // Build SQS batch entries with FIFO parameters
      .map((item, idx) => ({
        Id: idx.toString(),
        // Only post the required information to SQS
        MessageBody: JSON.stringify(item as NotifyDataItem),
        // FIFO
        // We dedupe on both nhs number and ods code
        MessageDeduplicationId: saltedHash(`${item.PatientNHSNumber}:${item.PharmacyODSCode}`, sqsSalt),
        MessageGroupId: requestId,
        MessageAttributes: {
          RequestId: {
            DataType: "String",
            StringValue: requestId
          }
        }
      }))
    // We could do a round of deduplications here, but benefits would be minimal and AWS SQS will do it for us anyway.

    logger.info(
      "For this batch, this is the results of filtering out unwanted statuses and parsing to SQS message entries",
      {
        batchLength: batch.length,
        entriesLength: entries.length,
        entriesStatuses: batch.map((el) => el.Status)
      }
    )

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

        // For each successful message, get its message ID. I don't think there will ever be undefined
        // actually in here, but the typing suggests that there could be so filter those out
        out.push(...result.Successful.map(e => e.MessageId).filter(msg_id => msg_id !== undefined))
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

  return out
}

export async function removeSqsMessages(
  logger: Logger,
  receiptHandles: Array<string>
): Promise<void> {
  // If there is no data, just noop
  if (receiptHandles.length === 0) return

  logger.info("Removing SQS messages from the queue", {receiptHandles})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  // batch at most 10 deletes per request
  const batches = chunkArray(receiptHandles, 10)

  for (const batch of batches) {
    const entries = batch.map((handle, idx) => ({
      Id: idx.toString(),
      ReceiptHandle: handle
    }))

    try {
      const command = new DeleteMessageBatchCommand({
        QueueUrl: sqsUrl,
        Entries: entries
      })
      const result = await sqs.send(command)

      if (result.Successful && result.Successful.length > 0) {
        logger.info("Successfully removed messages from the SQS queue", {
          successfulIds: result.Successful.map((r) => r.Id)
        })
      }

      if (result.Failed && result.Failed.length > 0) {
        logger.error("Failed to remove some messages from the SQS queue", {
          failures: result.Failed
        })
      }
    } catch (error) {
      logger.error("Error while removing messages from the SQS queue", {error})
      throw error
    }
  }
}
