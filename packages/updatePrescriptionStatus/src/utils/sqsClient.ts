import {Logger} from "@aws-lambda-powertools/logger"
import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {createHmac} from "node:crypto"

import {
  NotifyDataItem,
  PSUDataItem,
  PSUDataItemWithPrevious,
  SQSBatchMessage
} from "@psu-common/commonTypes"

import {checkSiteOrSystemIsNotifyEnabled} from "../validation/notificationSiteAndSystemFilters"

// eslint-disable-next-line max-len
const ENABLE_POST_DATED_NOTIFICATIONS = (process.env.ENABLE_POST_DATED_NOTIFICATIONS || "false").toLowerCase() === "true"

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

function buildSqsBatchEntries(
  items: Array<PSUDataItem>,
  requestId: string,
  sqsSalt: string
): Array<SQSBatchMessage> {
  return items.map((item, idx) => ({
    Id: idx.toString(),
    MessageBody: JSON.stringify(item as NotifyDataItem),
    MessageDeduplicationId: saltedHash(`${item.PatientNHSNumber}:${item.PharmacyODSCode}`, sqsSalt),
    MessageGroupId: requestId,
    MessageAttributes: {
      RequestId: {
        DataType: "String",
        StringValue: requestId
      }
    }
  }))
}

/**
 * Sends entries to the SQS queue in batches of 10
 * @param entries
 * @param queueUrl
 * @param requestId
 * @param logger
 * @returns An array of the created MessageIds
 */
async function sendEntriesToQueue(
  entries: Array<SQSBatchMessage>,
  queueUrl: string,
  requestId: string,
  logger: Logger
): Promise<Array<string>> {
  if (!entries.length) {
    return []
  }

  const batches = chunkArray(entries, 10)

  // Each batch is converted to an array of strings, so we end up with an array of arrays of strings
  // (or rather, their promises)
  const batchPromises = batches.map(async batch => {
    try {
      logger.info(
        "Pushing a batch of notification requests to SQS",
        {
          batchLength: batch.length,
          deduplicationIds: batch.map(e => e.MessageDeduplicationId),
          requestId,
          queueUrl
        }
      )

      const command = new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch
      })
      const result = await sqs.send(command)

      let successfulIds: Array<string> = []
      if (result.Successful?.length) {
        logger.info("Successfully sent a batch of prescriptions to the SQS", {result, queueUrl})

        // For each successful message, get its message ID. I don't think there will ever be undefined
        // actually in here, but the typing suggests that there could be so filter those out
        successfulIds = result.Successful
          .map(e => e.MessageId)
          .filter((msgId): msgId is string => msgId !== undefined)
      }

      // Some may succeed, and some may fail. So check for both
      if (result.Failed?.length) {
        throw new Error(`Failed to send a batch of prescriptions to the SQS ${queueUrl}`)
      }

      return successfulIds
    } catch (error) {
      logger.error("Failed to send a batch of prescriptions to the SQS", {error, queueUrl})
      throw error
    }
  })

  // Flatten the array of arrays of strings into a single array of strings
  const batchResults = Promise.all(batchPromises).then(results => results.flat())
  return batchResults
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
      logger.info("Fetched SQS_SALT from Secrets Manager", {secretJson})

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

function norm(str: string) {
  return str.toLowerCase().trim()
}

/**
 * Pushes an array of PSUDataItem to the notifications SQS queue
 * Uses SendMessageBatch to send up to 10 at a time
 * Contains the logic for filtering which items should be sent, based on
 * which sites/systems are enabled, and which statuses are to be sent
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

  // Only allow through sites and systems that are allowedSitesAndSystems
  const allowedSitesAndSystemsData = await checkSiteOrSystemIsNotifyEnabled(data)

  // Only these statuses will be pushed to the SQS
  const updateStatuses: Set<string> = new Set([
    norm("ready to collect"),
    norm("ready to collect - partial")
  ])

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

  let sqsPromises: Promise<Array<string>>
  if (ENABLE_POST_DATED_NOTIFICATIONS) {
    logger.info("Post-dated notifications are enabled, separating post-dated and non-post-dated items")

    if (!postDatedSqsUrl) {
      logger.warn("Post-dated Notifications SQS URL not found in environment variables")
      throw new Error("Post-dated Notifications SQS URL not configured")
    }

    // Build two arrays, one of all post dated, and one of all non-post-dated
    const postDatedItems = changedStatus.filter(item => item.PostDatedLastModifiedSetAt)
    const nonPostDatedItems = changedStatus.filter(item => !item.PostDatedLastModifiedSetAt)

    const postDatedMessageIds = sendItemsToSQS(postDatedItems, postDatedSqsUrl, requestId, logger)
    const nonPostDatedMessageIds = sendItemsToSQS(nonPostDatedItems, sqsUrl, requestId, logger)
    sqsPromises = Promise.all([postDatedMessageIds, nonPostDatedMessageIds]).then(results => results.flat())
  } else {
    logger.info("Post-dated notifications are disabled, sending all items to the standard notifications queue")
    sqsPromises = sendItemsToSQS(changedStatus, sqsUrl, requestId, logger)
  }

  logger.info(
    "The following patients will have prescription update app notifications requested",
    {nhsNumbers: changedStatus.map(e => e.PatientNHSNumber)}
  )

  return sqsPromises
}

/**
 *
 * @param items
 * @param sqsUrl
 * @param requestId
 * @param logger
 * @returns an array of the sent MessageIDs
 */
async function sendItemsToSQS(
  items: Array<PSUDataItem>,
  sqsUrl: string,
  requestId: string,
  logger: Logger
): Promise<Array<string>> {
  if (items.length === 0) {
    logger.info("No items to send to SQS", {sqsUrl})
    return []
  }

  logger.info(`Placing ${items.length} entries into the SQS queue`, {sqsUrl})

  const sqsSalt = await getSaltValue(logger)

  const entries = buildSqsBatchEntries(
    items,
    requestId,
    sqsSalt
  )

  return sendEntriesToQueue(entries, sqsUrl, requestId, logger)
}
