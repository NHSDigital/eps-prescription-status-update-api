import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, QueryCommand, QueryCommandInput} from "@aws-sdk/client-dynamodb"
import {unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem, PostDatedNotifyDataItem} from "@psu-common/commonTypes"
import {
  PostDatedPrescriptionWithExistingRecords,
  PostDatedSQSMessage,
  PostDatedSQSMessageWithExistingRecords
} from "./types"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"
const pharmacyPrescriptionIndexName = "PharmacyODSCodePrescriptionIDIndex"

function createPrescriptionLookupKey(prescriptionID: string, pharmacyODSCode: string): string {
  return `${prescriptionID.toUpperCase()}#${pharmacyODSCode.toUpperCase()}`
}

/**
 * Query the PrescriptionStatusUpdates table for all records matching a given prescription ID and ODS code.
 *
 * @param prescriptionID - The prescription ID to query for
 * @param pharmacyODSCode - The pharmacy ODS code to query for
 * @param logger - The AWS Lambda Powertools logger instance
 * @returns Array of PSUDataItem records matching the prescription ID
 */
export async function getExistingRecordsByPrescriptionID(
  prescriptionID: string,
  pharmacyODSCode: string,
  logger: Logger
): Promise<Array<PSUDataItem>> {
  const normalizedPrescriptionID = prescriptionID.toUpperCase()
  const normalizedPharmacyODSCode = pharmacyODSCode.toUpperCase()

  // Use the GSI to query by PharmacyODSCode and PrescriptionID
  const query: QueryCommandInput = {
    TableName: tableName,
    IndexName: pharmacyPrescriptionIndexName,
    KeyConditionExpression: "PharmacyODSCode = :ods AND PrescriptionID = :pid",
    ExpressionAttributeValues: {
      ":ods": {S: normalizedPharmacyODSCode},
      ":pid": {S: normalizedPrescriptionID}
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
        prescriptionID: normalizedPrescriptionID,
        pharmacyODSCode: normalizedPharmacyODSCode,
        tableName,
        indexName: pharmacyPrescriptionIndexName
      })

      const result = await client.send(new QueryCommand(query))

      if (result.Items) {
        const parsedItems = result.Items.map((item) => unmarshall(item) as PSUDataItem)
        items = items.concat(parsedItems)
      }

      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey)

    logger.info("Retrieved existing prescription records from DynamoDB", {
      prescriptionID: normalizedPrescriptionID,
      pharmacyODSCode: normalizedPharmacyODSCode,
      recordCount: items.length
    })

    // Sort by LastModified ascending so most recent is last
    items.sort((a, b) => new Date(a.LastModified).valueOf() - new Date(b.LastModified).valueOf())

    return items
  } catch (err) {
    logger.error("Error querying DynamoDB for existing prescription records", {
      prescriptionID: normalizedPrescriptionID,
      pharmacyODSCode: normalizedPharmacyODSCode,
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

  // Cache fetch promises per unique prescription/ODS pair to avoid duplicate lookups
  const recordsPromises = new Map<string, Promise<Array<PSUDataItem>>>()

  const getOrCreateRecordsPromise = (
    prescriptionID: string,
    pharmacyODSCode: string
  ): Promise<Array<PSUDataItem>> => {
    const lookupKey = createPrescriptionLookupKey(prescriptionID, pharmacyODSCode)

    if (!recordsPromises.has(lookupKey)) {
      const fetchPromise = (async () => {
        try {
          return await getExistingRecordsByPrescriptionID(prescriptionID, pharmacyODSCode, logger)
        } catch (error) {
          logger.error("Failed to fetch existing records for prescription", {
            prescriptionID,
            pharmacyODSCode,
            error
          })
          return []
        }
      })()

      recordsPromises.set(lookupKey, fetchPromise)
    }

    return recordsPromises.get(lookupKey)!
  }

  // Each element of recordsPromises is a wrapper around the actual fetch promise for that ID/ODS pair

  // Now, we map over the fetch promise wrappers, and await them all in parallel
  const results: Array<PostDatedPrescriptionWithExistingRecords> = await Promise.all(
    postDatedItems.map(async (postDatedData) => ({
      postDatedData,
      existingRecords: await getOrCreateRecordsPromise(
        postDatedData.PrescriptionID,
        postDatedData.PharmacyODSCode
      )
    }))
  )

  logger.info("fetched existing prescription update records for all post-dated prescription IDs", {
    totalPrescriptions: postDatedItems.length,
    uniquePrescriptionLookups: recordsPromises.size
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
