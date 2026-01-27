import {Logger} from "@aws-lambda-powertools/logger"

import {PostDatedSQSMessageWithExistingRecords} from "./types"

const POST_DATED_OVERRIDE = process.env.POST_DATED_OVERRIDE === "true"
const POST_DATED_OVERRIDE_VALUE = process.env.POST_DATED_OVERRIDE_VALUE === "true"

/**
 * Process a single post-dated prescription message.
 * This is a placeholder function that I'll implement properly later.
 *
 * @param logger - The AWS Lambda Powertools logger instance
 * @param message - The SQS message containing post-dated prescription data and existing records
 * @returns Promise<boolean> - true if the post-dated prescription has matured, and false otherwise
 */
export async function processMessage(
  logger: Logger,
  message: PostDatedSQSMessageWithExistingRecords
): Promise<boolean> {
  logger.info("Processing post-dated prescription message (dummy)", {
    messageId: message.MessageId,
    prescriptionData: message.prescriptionData,
    existingRecordsCount: message.existingRecords.length,
    existingRecordTaskIds: message.existingRecords.map((r) => r.TaskID)
  })
  if (POST_DATED_OVERRIDE) {
    logger.info("Post-dated override is enabled, returning override value", {
      overrideValue: POST_DATED_OVERRIDE_VALUE
    })
    return POST_DATED_OVERRIDE_VALUE
  }

  // TODO: Implement actual business logic for post-dated prescription processing
  // The existingRecords array contains all records from the DynamoDB table
  // that match this prescription's PrescriptionID

  // NOTE: It is technically possible for the array to be empty if no existing records are found
  // This SHOULD never happen in practice, but the code should handle it gracefully just in case

  const mostRecentRecord = message.existingRecords.reduce((latest, record) => {
    return new Date(record.LastModified) > new Date(latest.LastModified) ? record : latest
  }, message.existingRecords[0])
  const mostRecentLastModified = new Date(mostRecentRecord.LastModified)
  const desiredTransitionTime = new Date(mostRecentRecord.PostDatedLastModifiedSetAt as string)
  const currentTime = new Date()
  logger.info("Post-dated prescription timing details", {
    mostRecentLastModified: mostRecentLastModified.toISOString(),
    desiredTransitionTime: desiredTransitionTime.toISOString(),
    currentTime: currentTime.toISOString()
  })

  return true
}
