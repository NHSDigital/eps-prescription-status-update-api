import {Logger} from "@aws-lambda-powertools/logger"

import {PSUDataItem} from "@psu-common/commonTypes"

import {PostDatedSQSMessageWithRecentDataItem, PostDatedProcessingResult} from "./types"

// This is only used in the dynamo handler, but since it's part of the core logic of determining maturity,
// it felt wrong to put it in the database client file
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
export function determineAction(
  logger: Logger,
  message: PostDatedSQSMessageWithRecentDataItem
): PostDatedProcessingResult {
  logger.info("Processing post-dated prescription message", {
    messageId: message.MessageId,
    prescriptionData: message.prescriptionData,
    mostRecentRecord: message.mostRecentRecord
  })

  // The existingRecords array contains all records from the DynamoDB table
  // that match this prescription's PrescriptionID

  // NOTE: It is technically possible for this to be undefined if no existing records are found
  // This SHOULD never happen in practice, but catch it anyway
  if (!message.mostRecentRecord) {
    logger.error("No existing records found for post-dated prescription, cannot process. Ignoring this message", {
      badMessage: message
    })

    // throw new Error("No existing records found for post-dated prescription") // maybe?
    return PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE
  }

  // Is it post-dated?
  if (!message.mostRecentRecord.PostDatedLastModifiedSetAt) {
    logger.info(
      "Most recent record is not marked as post-dated, and will have been processed " +
      "by the standard logic already. Marking as to be ignored by the post-dated notifications lambda."
    )
    return PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE
  }

  // Is it still RTC?
  const mostRecentStatus = message.mostRecentRecord.Status.toLowerCase()
  const notifiableStatuses: Array<string> = ["ready to collect", "ready to collect - partial"]
  if (!notifiableStatuses.includes(mostRecentStatus)) {
    logger.info("Most recent status in the NPPTS data store is not a notifiable status, so will be ignored", {
      mostRecentStatus: mostRecentStatus
    })
    return PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE
  }

  // We know that we have a recent, post-dated prescription status update.
  // Check if its LastModified time is in the future.

  // Stored as YYYY-MM-DDTHH:mm:ss.sssZ
  const mostRecentLastModified = new Date(message.mostRecentRecord.LastModified)
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
    return PostDatedProcessingResult.REPROCESS
  }

  logger.info("Post-dated prescription has matured (LastModified is in the past)", {
    lastModified: mostRecentLastModified.toISOString(),
    currentTime: currentTime.toISOString()
  })

  return PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS
}

/**
 * returns time in seconds until maturity, or undefined if cannot be determined
 */
export function computeTimeUntilMaturity(
  data: PostDatedSQSMessageWithRecentDataItem
): number | undefined {
  const prescriptionRecord = data.mostRecentRecord

  // catches both no existing record, and one that's not post-dated.
  if (!prescriptionRecord?.PostDatedLastModifiedSetAt) {
    return undefined
  }

  const lastModified = new Date(prescriptionRecord.LastModified)
  const currentTime = Date.now()

  return (lastModified.getTime() - currentTime) / 1000
}
