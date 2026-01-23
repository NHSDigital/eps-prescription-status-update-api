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
 * There should always be at least one result, but there may be multiple if the prescription has been
 * updated multiple times.
 *
 * @param prescriptionID - The prescription ID to query for
 * @param pharmacyODSCode - The pharmacy ODS code to query for
 * @param logger - The AWS Lambda Powertools logger instance
 * @returns Array of PSUDataItem records matching the prescription ID. Sorted by LastModified descending.
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

    // Sort by LastModified ascending so most recent is first
    items.sort((a, b) => new Date(b.LastModified).valueOf() - new Date(a.LastModified).valueOf())

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
 * @returns Array of objects containing both the post-dated data and existing records.
 *   Existing records are sorted by LastModified descending.
 */
export async function fetchExistingRecordsForPrescriptions(
  postDatedItems: Array<PostDatedNotifyDataItem>,
  logger: Logger
): Promise<Array<PostDatedPrescriptionWithExistingRecords>> {
  logger.info("Fetching existing records for post-dated prescriptions", {
    prescriptionCount: postDatedItems.length
  })

  // The data table is indexed by both PrescriptionID and PharmacyODSCode, so build a map keyed by these
  // in combination. Should avoid duplicate queries this way.
  const uniquePrescriptionLookups = new Map<string, {prescriptionID: string; pharmacyODSCode: string}>()
  for (const item of postDatedItems) {
    const lookupKey = createPrescriptionLookupKey(item.PrescriptionID, item.PharmacyODSCode)
    if (!uniquePrescriptionLookups.has(lookupKey)) {
      uniquePrescriptionLookups.set(lookupKey, {
        prescriptionID: item.PrescriptionID,
        pharmacyODSCode: item.PharmacyODSCode
      })
    }
  }

  const existingRecordsMap = new Map<string, Array<PSUDataItem>>()
  await Promise.all(
    Array.from(uniquePrescriptionLookups.entries()).map(async ([lookupKey, {prescriptionID, pharmacyODSCode}]) => {
      try {
        const records = await getExistingRecordsByPrescriptionID(prescriptionID, pharmacyODSCode, logger)
        existingRecordsMap.set(lookupKey, records)
      } catch (error) {
        logger.error("Failed to fetch existing records for prescription", {
          prescriptionID,
          pharmacyODSCode,
          error
        })
        // Store empty array on error to allow processing to continue
        // TODO: Make sure later, that if existingRecords is empty, we handle that
        existingRecordsMap.set(lookupKey, [])
      }
    })
  )

  // Map each post-dated item to its corresponding existing records
  const results: Array<PostDatedPrescriptionWithExistingRecords> = postDatedItems.map(
    (postDatedData) => {
      const lookupKey = createPrescriptionLookupKey(postDatedData.PrescriptionID, postDatedData.PharmacyODSCode)
      const existingRecords = existingRecordsMap.get(lookupKey) ?? []

      return {
        postDatedData,
        existingRecords
      }
    })

  logger.info("fetched existing prescription update records for all post-dated prescription IDs", {
    totalPrescriptions: postDatedItems.length,
    uniquePrescriptionLookups: existingRecordsMap.size
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

  for (const msg of enrichedMessages) {
    logger.info("Prescription and most recent existing record", {
      prescriptionID: msg.prescriptionData.PrescriptionID,
      existingRecordCount: msg.existingRecords.length,
      mostRecentExistingRecord: msg.existingRecords.length > 0
        ? msg.existingRecords[0]
        : null
    })
  }

  return enrichedMessages
}
