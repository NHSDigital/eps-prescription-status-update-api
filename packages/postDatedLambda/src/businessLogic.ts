import {Logger} from "@aws-lambda-powertools/logger"

import {PSUDataItem} from "@psu-common/commonTypes"

import {PostDatedSQSMessageWithExistingRecords, PostDatedProcessingResult} from "./types"

// defaults to false
const POST_DATED_OVERRIDE = process.env.POST_DATED_OVERRIDE === "true"

// set from environment variable POST_DATED_OVERRIDE_VALUE
const POST_DATED_OVERRIDE_VALUE_ENV = process.env.POST_DATED_OVERRIDE_VALUE ?? "ignore"
let POST_DATED_OVERRIDE_VALUE: PostDatedProcessingResult
switch (POST_DATED_OVERRIDE_VALUE_ENV.toLowerCase()) {
  case "matured":
    POST_DATED_OVERRIDE_VALUE = PostDatedProcessingResult.MATURED
    break
  case "immature":
    POST_DATED_OVERRIDE_VALUE = PostDatedProcessingResult.IMMATURE
    break
  default:
    POST_DATED_OVERRIDE_VALUE = PostDatedProcessingResult.IGNORE
    break
}

export function getMostRecentRecord(
  existingRecords: Array<PSUDataItem>
): PSUDataItem {
  return existingRecords.reduce((latest, record) => {
    const latestTimestamp = latest.PostDatedLastModifiedSetAt
      ? new Date(latest.PostDatedLastModifiedSetAt)
      : new Date(latest.LastModified)
    const recordTimestamp = record.PostDatedLastModifiedSetAt
      ? new Date(record.PostDatedLastModifiedSetAt)
      : new Date(record.LastModified)
    return recordTimestamp > latestTimestamp ? record : latest
  }, existingRecords[0])
}

/**
 * Process a single post-dated prescription message.
 * A flow diagram of this logic is available at ../docs/mature_prescription_check.md
 *
 * @param logger - The AWS Lambda Powertools logger instance
 * @param message - The SQS message containing post-dated prescription data and existing records
 * @returns Promise<boolean> - true if the post-dated prescription has matured, and false otherwise
 */
export function processMessage(
  logger: Logger,
  message: PostDatedSQSMessageWithExistingRecords
): string {
  logger.info("Processing post-dated prescription message", {
    messageId: message.MessageId,
    prescriptionData: message.prescriptionData,
    existingRecords: message.existingRecords
  })
  if (POST_DATED_OVERRIDE) {
    logger.info("Post-dated override is enabled, returning override value", {
      overrideValue: POST_DATED_OVERRIDE_VALUE
    })
    return POST_DATED_OVERRIDE_VALUE
  }

  // The existingRecords array contains all records from the DynamoDB table
  // that match this prescription's PrescriptionID

  // NOTE: It is technically possible for the array to be empty if no existing records are found
  // This SHOULD never happen in practice, but catch it anyway
  if (message.existingRecords.length === 0) {
    logger.error("No existing records found for post-dated prescription, cannot process. Ignoring this message", {
      badMessage: message
    })

    // throw new Error("No existing records found for post-dated prescription") // maybe?
    return PostDatedProcessingResult.IGNORE
  }

  // We only care about the most recent submission for this prescription
  // If PostDatedLastModifiedSetAt IS set, it is the timestamp we received the submission
  // If it is NOT set, then LastModified is the timestamp we received the submission
  const mostRecentRecord = getMostRecentRecord(message.existingRecords)

  logger.info("Most recent NPPTS record for post-dated processing", {
    mostRecentRecord
  })

  // Is it post-dated?
  if (!mostRecentRecord.PostDatedLastModifiedSetAt) {
    logger.info(
      "Most recent record is not marked as post-dated, and will have been processed " +
      "by the standard logic already. Marking as to be ignored by the post-dated notifications lambda."
    )
    return PostDatedProcessingResult.IGNORE
  }

  // Is it still RTC?
  const mostRecentStatus = mostRecentRecord.Status.toLowerCase()
  const notifiableStatuses: Array<string> = ["ready to collect", "ready to collect - partial"]
  if (!notifiableStatuses.includes(mostRecentStatus)) {
    logger.info("Most recent status in the NPPTS data store is not a notifiable status, so will be ignored", {
      mostRecentStatus: mostRecentStatus
    })
    return PostDatedProcessingResult.IGNORE
  }

  // We know that we have a recent, post-dated prescription status update.
  // Check if its LastModified time is in the future.

  // Stored as YYYY-MM-DDTHH:mm:ss.sssZ
  const mostRecentLastModified = new Date(mostRecentRecord.LastModified)
  const currentTime = new Date()
  logger.info("Most recent NPPTS record is Post-dated. Checking if the post-dated prescription has matured", {
    LastModified: mostRecentLastModified.toISOString(),
    currentTime: currentTime.toISOString()
  })

  if (mostRecentLastModified > currentTime) {
    logger.info("Post-dated prescription is still immature (LastModified is in the future)", {
      lastModified: mostRecentLastModified.toISOString(),
      currentTime: currentTime.toISOString()
    })
    return PostDatedProcessingResult.IMMATURE
  }

  logger.info("Post-dated prescription has matured (LastModified is in the past)", {
    lastModified: mostRecentLastModified.toISOString(),
    currentTime: currentTime.toISOString()
  })

  return PostDatedProcessingResult.MATURED
}

/**
 * returns time in seconds until maturity, or undefined if cannot be determined
 */
export function computeTimeUntilMaturity(
  data: PostDatedSQSMessageWithExistingRecords
): number | undefined {
  const prescriptionRecord = getMostRecentRecord(data.existingRecords)
  if (!prescriptionRecord.PostDatedLastModifiedSetAt) {
    return undefined
  }

  const lastModified = new Date(prescriptionRecord.LastModified)
  const currentTime = new Date()

  return lastModified.getTime() - currentTime.getTime()
}
