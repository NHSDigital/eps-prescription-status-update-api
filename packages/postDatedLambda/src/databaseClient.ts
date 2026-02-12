import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, QueryCommand, QueryCommandInput} from "@aws-sdk/client-dynamodb"
import {unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem, NotifyDataItem} from "@psu-common/commonTypes"
import {PostDatedSQSMessage, PostDatedSQSMessageWithRecentDataItem} from "./types"
import {getMostRecentRecord} from "./businessLogic"

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
export async function getRecentDataItemByPrescriptionID(
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
        const parsedItems: Array<PSUDataItem> = result.Items.map((item) => unmarshall(item) as PSUDataItem)
        items.push(...parsedItems)
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

async function buildRecentDataItemMap(
  lookupRequests: Array<PrescriptionLookupRequest>,
  logger: Logger
): Promise<Map<string, Array<PSUDataItem>>> {
  const RecentDataItemMap = new Map<string, Array<PSUDataItem>>()

  // await all lookups in parallel
  await Promise.all(
    lookupRequests.map(async ({lookupKey, prescriptionID}) => {
      try {
        const records = await getRecentDataItemByPrescriptionID(prescriptionID, logger)
        RecentDataItemMap.set(lookupKey, records)
      } catch (error) {
        logger.error("Failed to fetch existing records for prescription", {
          prescriptionID,
          error
        })
        RecentDataItemMap.set(lookupKey, []) // Continue processing other prescriptions even when one fails
      }
    })
  )

  return RecentDataItemMap
}

/**
 * Enrich SQS messages with existing records from DynamoDB.
 * For each prescription ID in the messages, fetches any matching records from the table.
 *
 * @param messages - Array of SQS messages to enrich
 * @param logger - Logger instance
 * @returns Array of messages enriched with a mostRecentRecord field containing the most
 *   recent matching record from DynamoDB, if any. If no matching records are found,
 *   mostRecentRecord will be undefined.
 */
export async function enrichMessagesWithMostRecentDataItem(
  messages: Array<PostDatedSQSMessage>,
  logger: Logger
): Promise<Array<PostDatedSQSMessageWithRecentDataItem>> {
  if (messages.length === 0) {
    return []
  }

  const postDatedItems = messages.map((message) => message.prescriptionData)

  // There may be repeated prescription IDs in the messages.
  // Use a map to dedupe the lookups to dynamo, submit them all in async, then map the results back to the messages.
  const lookupRequests = buildLookupRequests(postDatedItems)
  const recentDataItemMap = await buildRecentDataItemMap(lookupRequests, logger)

  const enrichedMessages: Array<PostDatedSQSMessageWithRecentDataItem> = messages.map((message) => {
    const lookupKey = message.prescriptionData.PrescriptionID.toUpperCase()
    const existingRecords = recentDataItemMap.get(lookupKey) ?? []
    const mostRecentRecord = existingRecords.length > 0 ? getMostRecentRecord(existingRecords) : undefined

    return {
      ...message,
      mostRecentRecord
    }
  })

  return enrichedMessages
}
