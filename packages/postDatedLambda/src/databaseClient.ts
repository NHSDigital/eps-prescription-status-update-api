import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, QueryCommand, QueryCommandInput} from "@aws-sdk/client-dynamodb"
import {marshall, unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem, PostDatedNotifyDataItem} from "@psu-common/commonTypes"
import {
  PostDatedPrescriptionWithExistingRecords,
  PostDatedSQSMessage,
  PostDatedSQSMessageWithExistingRecords
} from "./types"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"

/**
 * Query the PrescriptionStatusUpdates table for all records matching a given prescription ID.
 *
 * @param prescriptionID - The prescription ID to query for
 * @param logger - The AWS Lambda Powertools logger instance
 * @returns Array of PSUDataItem records matching the prescription ID
 */
export async function getExistingRecordsByPrescriptionID(
  prescriptionID: string,
  logger: Logger
): Promise<Array<PSUDataItem>> {
  const query: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression: "PrescriptionID = :pid",
    ExpressionAttributeValues: {
      ":pid": marshall(prescriptionID)
    }
  }

  let lastEvaluatedKey
  let items: Array<PSUDataItem> = []

  try {
    do {
      if (lastEvaluatedKey) {
        query.ExclusiveStartKey = lastEvaluatedKey
      }

      logger.info("Querying DynamoDB for existing prescription records", {
        prescriptionID,
        tableName
      })

      const result = await client.send(new QueryCommand(query))

      if (result.Items) {
        const parsedItems = result.Items.map((item) => unmarshall(item) as PSUDataItem)
        items = items.concat(parsedItems)
      }

      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey)

    logger.info("Retrieved existing prescription records from DynamoDB", {
      prescriptionID,
      recordCount: items.length
    })

    // Sort by LastModified ascending so most recent is last
    items.sort((a, b) => new Date(a.LastModified).valueOf() - new Date(b.LastModified).valueOf())

    return items
  } catch (err) {
    logger.error("Error querying DynamoDB for existing prescription records", {
      prescriptionID,
      error: err
    })
    throw err
  }
}

/**
 * For each post-dated prescription, fetch any existing records from DynamoDB
 * that have a matching prescription ID.
 *
 * @param postDatedItems - Array of post-dated prescription data items
 * @param logger - The AWS Lambda Powertools logger instance
 * @returns Array of objects containing both the post-dated data and existing records
 */
export async function fetchExistingRecordsForPrescriptions(
  postDatedItems: Array<PostDatedNotifyDataItem>,
  logger: Logger
): Promise<Array<PostDatedPrescriptionWithExistingRecords>> {
  logger.info("Fetching existing records for post-dated prescriptions", {
    prescriptionCount: postDatedItems.length
  })

  // Extract unique prescription IDs to avoid duplicate queries
  const uniquePrescriptionIDs = [...new Set(
    postDatedItems.map((item) => item.PrescriptionID)
  )]

  // Create a map of prescription ID to existing records
  const existingRecordsMap = new Map<string, Array<PSUDataItem>>()

  // Fetch existing records for each unique prescription ID
  await Promise.all(
    uniquePrescriptionIDs.map(async (prescriptionID) => {
      try {
        const records = await getExistingRecordsByPrescriptionID(prescriptionID, logger)
        existingRecordsMap.set(prescriptionID, records)
      } catch (error) {
        logger.error("Failed to fetch existing records for prescription", {
          prescriptionID,
          error
        })
        // Store empty array on error to allow processing to continue
        existingRecordsMap.set(prescriptionID, [])
      }
    })
  )

  // Map each post-dated item to its corresponding existing records
  const results: Array<PostDatedPrescriptionWithExistingRecords> = postDatedItems.map(
    (postDatedData) => {
      const existingRecords = existingRecordsMap.get(postDatedData.PrescriptionID) ?? []

      return {
        postDatedData,
        existingRecords
      }
    })

  logger.info("fetched existing prescription update records for all post-dated prescription IDs", {
    totalPrescriptions: postDatedItems.length,
    uniquePrescriptionIDs: uniquePrescriptionIDs.length
  })

  return results
}

/**
 * Enrich SQS messages with existing records from DynamoDB.
 * For each prescription ID in the messages, fetches any matching records from the table.
 *
 * @param messages - Array of SQS messages to enrich
 * @param logger - Logger instance
 * @returns Array of enriched messages with existing records
 */
export async function enrichMessagesWithExistingRecords(
  messages: Array<PostDatedSQSMessage>,
  logger: Logger
): Promise<Array<PostDatedSQSMessageWithExistingRecords>> {
  if (messages.length === 0) {
    return []
  }

  const postDatedItems = messages.map((m) => m.prescriptionData)

  const prescriptionsWithRecords = await fetchExistingRecordsForPrescriptions(postDatedItems, logger)
  const recordsMap = new Map(prescriptionsWithRecords.map((p) => [p.postDatedData.PrescriptionID, p.existingRecords]))
  const enrichedMessages: Array<PostDatedSQSMessageWithExistingRecords> = messages.map((message) => ({
    ...message,
    existingRecords: recordsMap.get(message.prescriptionData.PrescriptionID) ?? []
  }))

  logger.info("Enriched messages with existing records from DynamoDB", {
    messageCount: messages.length,
    messagesWithRecords: enrichedMessages.filter((m) => m.existingRecords.length > 0).length
  })

  return enrichedMessages
}
