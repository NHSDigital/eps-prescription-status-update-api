import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBClient, QueryCommand, QueryCommandInput} from "@aws-sdk/client-dynamodb"
import {unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"

/**
 * Query all items for a single PrescriptionID (handles pagination).
 */
async function fetchRecordsForPrescriptionID(
  applicationName: string,
  prescriptionID: string,
  logger: Logger
): Promise<Array<PSUDataItem>> {
  const items: Array<PSUDataItem> = []
  let ExclusiveStartKey: QueryCommandInput["ExclusiveStartKey"] | undefined

  logger.info("Querying items for PrescriptionID.", {prescriptionID})

  do {
    const input: QueryCommandInput = {
      TableName: tableName,
      KeyConditionExpression: "PrescriptionID = :pid",
      FilterExpression: "ApplicationName = :app",
      ExpressionAttributeValues: {
        ":app": {S: applicationName},
        ":pid": {S: prescriptionID}
      },
      ExclusiveStartKey,
      ConsistentRead: true
    }

    const result = await client.send(new QueryCommand(input))

    if (result.Items && result.Items.length) {
      items.push(...result.Items.map((i) => unmarshall(i) as PSUDataItem))
    }

    // Pagination. undefined if we got it all
    ExclusiveStartKey = result.LastEvaluatedKey
  } while (ExclusiveStartKey)

  // Chronological order since this might eventually be read by a human
  items.sort(
    (a, b) => new Date(a.LastModified).valueOf() - new Date(b.LastModified).valueOf()
  )

  logger.info("Finished query for PrescriptionID.", {
    prescriptionID,
    count: items.length
  })

  return items
}

export interface PrescriptionRecords {
  prescriptionId: string;
  PSUDataItems: Array<PSUDataItem>;
}

/**
 * Fetch all items for a list of PrescriptionIDs.
 * Returns a map keyed by PrescriptionID.
 */
export async function getItemsForPrescriptionIDs(
  applicationName: string,
  prescriptionIDs: Array<string>,
  logger: Logger,
  num_workers: number = 5
): Promise<Array<PrescriptionRecords>> {
  if (!prescriptionIDs || prescriptionIDs.length === 0) {
    return []
  }

  // De-duplicate IDs just in case
  const uniqueIDs = Array.from(new Set(prescriptionIDs))

  const results: Array<PrescriptionRecords> = []

  let idx = 0
  async function worker() {
    while (idx < uniqueIDs.length) {
      const current = uniqueIDs[idx++]
      try {
        const items = await fetchRecordsForPrescriptionID(applicationName, current, logger)
        results.push({prescriptionId: current, PSUDataItems: items})
      } catch (e) {
        logger.error("Error querying PrescriptionID.", {prescriptionID: current, error: e})
        // Not sure if I should omit the ID entirely, or if I should return an empty array.
        // I'll do the latter for now since it can be ignored, and probably makes downstream
        // logic easier if each ID is guaranteed to have an entry.
        results.push({prescriptionId: current, PSUDataItems: []})
      }
    }
  }

  const workers = Array.from({length: Math.min(num_workers, uniqueIDs.length)}, () => worker())
  await Promise.all(workers)

  return results
}
