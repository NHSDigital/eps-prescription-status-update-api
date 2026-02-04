import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, QueryCommand, QueryCommandInput} from "@aws-sdk/client-dynamodb"
import {unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem, NotifyDataItem} from "@psu-common/commonTypes"
import {
  PostDatedPrescriptionWithExistingRecords,
  PostDatedSQSMessage,
  PostDatedSQSMessageWithExistingRecords
} from "./types"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"
const pharmacyPrescriptionIndexName = "PrescriptionIDPostDatedIndex"

type PrescriptionLookupRequest = {
  lookupKey: string
  prescriptionID: string
}

/**
 * Query the PrescriptionStatusUpdates table for all records matching a given prescription ID.
 * There should always be at least one result, but there may be multiple if the prescription has been
 * updated multiple times.
 *
 * @param prescriptionID - The prescription ID to query for
 * @param logger - The AWS Lambda Powertools logger instance
 * @returns Array of PSUDataItem records matching the prescription ID. Sorted by LastModified descending.
 */
export async function getExistingRecordsByPrescriptionID(
  prescriptionID: string,
  logger: Logger
): Promise<Array<PSUDataItem>> {
  const normalizedPrescriptionID = prescriptionID.toUpperCase()

  // Use the GSI to query by PrescriptionID
  const query: QueryCommandInput = {
    TableName: tableName,
    IndexName: pharmacyPrescriptionIndexName,
    KeyConditionExpression: "PrescriptionID = :pid",
    ExpressionAttributeValues: {
      ":pid": {S: normalizedPrescriptionID}
    }
  }

  let lastEvaluatedKey
  let items: Array<PSUDataItem> = []

  logger.info("Querying DynamoDB for existing prescription records", {
    prescriptionID: normalizedPrescriptionID,
    tableName,
    indexName: pharmacyPrescriptionIndexName
  })

  try {
    while (true) {
      if (lastEvaluatedKey) {
        query.ExclusiveStartKey = lastEvaluatedKey
      }

      const result = await client.send(new QueryCommand(query))

      if (result.Items) {
        const parsedItems = result.Items.map((item) => unmarshall(item) as PSUDataItem)
        items.push(parsedItems)
      }

      lastEvaluatedKey = result.LastEvaluatedKey
      if (!lastEvaluatedKey) {
        break
      }
    }

    logger.info("Retrieved existing prescription records from DynamoDB", {
      prescriptionID: normalizedPrescriptionID,
      recordCount: items.length
    })

    return items
  } catch (err) {
    logger.error("Error querying DynamoDB for existing prescription records", {
      prescriptionID: normalizedPrescriptionID,
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
 * @returns Array of objects containing both the post-dated data and existing records.
 *   Existing records are sorted by LastModified descending.
 */
export async function fetchExistingRecordsForPrescriptions(
  postDatedItems: Array<NotifyDataItem>,
  logger: Logger
): Promise<Array<PostDatedPrescriptionWithExistingRecords>> {
  logger.info("Fetching existing records for post-dated prescriptions", {
    prescriptionCount: postDatedItems.length,
    prescriptionIDs: postDatedItems.map((p) => p.PrescriptionID)
  })
  const lookupRequests = buildLookupRequests(postDatedItems)
  const existingRecordsMap = await buildExistingRecordsMap(lookupRequests, logger)

  // Map each post-dated item to its corresponding existing records
  const results: Array<PostDatedPrescriptionWithExistingRecords> = postDatedItems.map(
    (postDatedData) => {
      const lookupKey = postDatedData.PrescriptionID.toUpperCase() // Case insensitive
      const existingRecords = existingRecordsMap.get(lookupKey) ?? []

      return {
        postDatedData,
        existingRecords
      }
    })

  return results
}

function buildLookupRequests(postDatedItems: Array<NotifyDataItem>): Array<PrescriptionLookupRequest> {
  // Run though a map to deduplicate lookups
  const lookups = new Map<string, PrescriptionLookupRequest>()

  for (const item of postDatedItems) {
    const lookupKey = item.PrescriptionID.toUpperCase() // Case insensitive

    // dont worry about overwriting entries, since they'll be identical
    lookups.set(lookupKey, {
      lookupKey,
      prescriptionID: item.PrescriptionID
    })
  }

  return Array.from(lookups.values())
}

async function buildExistingRecordsMap(
  lookupRequests: Array<PrescriptionLookupRequest>,
  logger: Logger
): Promise<Map<string, Array<PSUDataItem>>> {
  const existingRecordsMap = new Map<string, Array<PSUDataItem>>()

  // await all lookups in parallel
  await Promise.all(
    lookupRequests.map(async ({lookupKey, prescriptionID}) => {
      try {
        const records = await getExistingRecordsByPrescriptionID(prescriptionID, logger)
        existingRecordsMap.set(lookupKey, records)
      } catch (error) {
        logger.error("Failed to fetch existing records for prescription", {
          prescriptionID,
          error
        })
        existingRecordsMap.set(lookupKey, []) // Continue processing other prescriptions even when one fails
      }
    })
  )

  return existingRecordsMap
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
  const postDatedItems = messages.map((m) => m.prescriptionData)

  const prescriptionsWithRecords = await fetchExistingRecordsForPrescriptions(postDatedItems, logger)
  // prescription IDs are unique, even across pharmacies. so we can build a map keyed by prescription ID just fine.
  const recordsMap = new Map(prescriptionsWithRecords.map((p) => [p.postDatedData.PrescriptionID, p.existingRecords]))
  const enrichedMessages: Array<PostDatedSQSMessageWithExistingRecords> = messages.map((message) => ({
    ...message,
    existingRecords: recordsMap.get(message.prescriptionData.PrescriptionID) ?? []
  }))

  return enrichedMessages
}
