import {Logger} from "@aws-lambda-powertools/logger"
import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {createHmac} from "node:crypto"

import {
  NotifyDataItem,
  PostDatedNotifyDataItem,
  PSUDataItem,
  PSUDataItemWithPrevious
} from "@psu-common/commonTypes"

import {checkSiteOrSystemIsNotifyEnabled} from "../validation/notificationSiteAndSystemFilters"

type SQSBatchMessage = {
  Id: string
  MessageBody: string
  MessageDeduplicationId: string
  MessageGroupId: string
  MessageAttributes: {[key: string]: {DataType: string; StringValue: string}}
}

const sqsUrl: string | undefined = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL
const postDatedSqsUrl: string | undefined = process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL

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

  if (process.env.SQS_SALT) {
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
  } else {
    // No secret name configured at all, so fall back
    sqsSalt = fallbackSalt
  }

  if (sqsSalt === fallbackSalt) {
    logger.warn(
      "Using the fallback salt value - please update the environment variable `SQS_SALT` to a random value."
    )
  }

  return sqsSalt
}

async function placeBatchInSQS(
  batches: Array<Array<SQSBatchMessage>>,
  sqsUrl: string,
  requestId: string,
  logger: Logger
) {

  // Used for the return value
  let out: Array<string> = []

  for (const batch of batches) {
    try {
      logger.info(
        "Pushing a batch of notification requests to SQS",
        {
          batchLength: batch.length,
          deduplicationIds: batch.map(e => e.MessageDeduplicationId),
          requestId
        }
      )

      const command = new SendMessageBatchCommand({
        QueueUrl: sqsUrl,
        Entries: batch
      })
      const result = await sqs.send(command)
      if (result.Successful?.length) {
        logger.info("Successfully sent a batch of prescriptions to the notifications SQS", {result})

        // For each successful message, get its message ID. I don't think there will ever be undefined
        // actually in here, but the typing suggests that there could be so filter those out
        out.push(...result.Successful.map(e => e.MessageId).filter(msg_id => msg_id !== undefined))
      }
      // Some may succeed, and some may fail. So check for both
      if (result.Failed?.length) {
        throw new Error("Failed to send a batch of prescriptions to the notifications SQS")
      }
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the notifications SQS", {error})
      throw error
    }
  }

  return out
}

function norm(str: string) {
  return str.toLowerCase().trim()
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
  data: Array<PSUDataItemWithPrevious>,
  logger: Logger
): Promise<Array<string>> {
  logger.info("Checking if any items require notifications", {numItemsToBeChecked: data.length, sqsUrl})

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not found in environment variables")
    throw new Error("Notifications SQS URL not configured")
  }

  if (!postDatedSqsUrl) {
    logger.warn("Post-dated Notifications SQS URL not found in environment variables")
    throw new Error("Post-dated Notifications SQS URL not configured")
  }

  // Only allow through sites and systems that are allowedSitesAndSystems
  const allowedSitesAndSystemsData = await checkSiteOrSystemIsNotifyEnabled(data)

  // Only these statuses will be pushed to the SQS
  const updateStatuses: Set<string> = new Set([
    norm("ready to collect"),
    norm("ready to collect - partial")
  ])
  // Salt for the deduplication hash
  const sqsSalt = await getSaltValue(logger)

  // Get only items which have the correct current statuses
  const candidates = allowedSitesAndSystemsData.filter(
    (item) => updateStatuses.has(norm(item.current.Status))
  )

  // we don't want items that have gone from "ready to collect" to "ready to collect"
  // So chuck those out.
  const changedStatus = candidates
    .filter(({current, previous}) => {
      if (!previous) return true // no previous item (or hit an error getting one) -> treat as changed
      return norm(current.Status) !== norm(previous.Status)
    })
    .map(({current}) => current)

  // Build two arrays, one of all post dated, and one of all non-post-dated
  const postDatedItems = changedStatus.filter(item => item.PostDatedLastModifiedSetAt)
  const nonPostDatedItems = changedStatus.filter(item => !item.PostDatedLastModifiedSetAt)

  sendPostDatedItemsToSQS(postDatedItems, requestId, logger)

  // Build SQS batch entries with FIFO parameters
  const allEntries: Array<SQSBatchMessage> = nonPostDatedItems
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

  if (!allEntries.length) {
    // Carry on if we have no updates to make.
    logger.info("No entries to post to the notifications SQS")
    return []
  }

  logger.info(
    "The following patients will have prescription update app notifications requested",
    {nhsNumbers: allowedSitesAndSystemsData.map(e => e.current.PatientNHSNumber)}
  )

  // Remove post-dated entries from the normal flow
  const currentlyValidEntries = allEntries.filter(entry => {
    const body: NotifyDataItem = JSON.parse(entry.MessageBody)
    return !("PostDatedLastModifiedSetAt" in body)
  })

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(currentlyValidEntries, 10)
  const out = await placeBatchInSQS(batches, sqsUrl, requestId, logger)

  return out
}

// FIXME: Remove this function once post-dated updates are deprecated
async function sendPostDatedItemsToSQS(
  postDatedItems: Array<PSUDataItem>,
  requestId: string,
  logger: Logger
): Promise<void> {
  if (postDatedItems.length === 0) {
    logger.info("No post-dated items to send to SQS")
    return
  }

  if (!postDatedSqsUrl) {
    logger.error("Post-dated Notifications SQS URL not found in environment variables")
    throw new Error("Post-dated Notifications SQS URL not configured")
  }

  logger.info(`Placing ${postDatedItems.length} post-dated entries into the post-dated SQS queue`)

  const sqsSalt = await getSaltValue(logger)

  // This time, instead of posting NotifyDataItem, we use PostDatedNotifyDataItem
  const allEntries: Array<SQSBatchMessage> = postDatedItems
    .map((item, idx) => ({
      Id: idx.toString(),
      // Only post the required information to SQS
      MessageBody: JSON.stringify(item as PostDatedNotifyDataItem),
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

  // SQS batch calls are limited to 10 messages per request, so chunk the data
  const batches = chunkArray(allEntries, 10)
  await placeBatchInSQS(batches, postDatedSqsUrl, requestId, logger)
}
