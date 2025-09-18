import {DynamoDBClient, QueryCommand} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"

import {LastNotificationStateType, NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {TTL_DELTA} from "./constants"
import {NotifyDataItemMessage} from "./types"

const marshallOptions = {
  // remove undefined when pushing to dynamo - references will be undefined when notify request fails
  removeUndefinedValues: true,
  // remove empty strings as well
  convertEmptyValues: true
}
const dynamo = new DynamoDBClient({region: process.env.AWS_REGION})
const docClient = DynamoDBDocumentClient.from(dynamo, {marshallOptions})

const dynamoTable = process.env.TABLE_NAME

export async function addPrescriptionMessagesToNotificationStateStore(
  logger: Logger,
  dataArray: Array<NotifyDataItemMessage>
) {
  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  if (dataArray.length) logger.info("Attempting to push data to DynamoDB", {count: dataArray.length})
  else logger.info("No data to push into DynamoDB.")

  for (const data of dataArray) {
    const item: LastNotificationStateType = {
      NHSNumber: data.PSUDataItem.PatientNHSNumber,
      ODSCode: data.PSUDataItem.PharmacyODSCode,
      RequestId: data.PSUDataItem.RequestID,
      SQSMessageID: data.MessageId,
      LastNotifiedPrescriptionStatus: data.PSUDataItem.Status,
      MessageStatus: data.messageStatus ?? "unknown", // Fall back to unknown if not set
      NotifyMessageID: data.notifyMessageId, // This is a GSI, but leaving it blank is fine
      NotifyMessageReference: data.messageReference,
      NotifyMessageBatchReference: data.messageBatchReference, // Will be undefined when request fails
      LastNotificationRequestTimestamp: new Date().toISOString(),
      ExpiryTime: (Math.floor(+new Date() / 1000) + TTL_DELTA)
    }

    try {
      await docClient.send(new PutCommand({
        TableName: dynamoTable,
        Item: item
      }))
      logger.debug("Upserted prescription")
    } catch (err) {
      logger.error("Failed to write to DynamoDB", {
        error: err,
        item
      })
      throw err
    }
    logger.info(
      "Finished upserting records to the dynamo table",
      {nhsNumbers: dataArray.map(el => el.PSUDataItem.PatientNHSNumber)}
    )
  }
}

/**
 * Returns TRUE if the patient HAS NOT received a recent notification.
 * Returns FALSE if the patient HAS received a recent notification
 *
 * @param logger - AWS logging object
 * @param update - The Prescription Status Update that we are checking
 * @param cooldownPeriod - Minimum time in seconds between notifications
 */
export async function checkCooldownForUpdate(
  logger: Logger,
  update: NotifyDataItem,
  cooldownPeriod: number = 7200
): Promise<boolean> {
  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  try {
    // Retrieve the notification states for this patient/pharmacy combo
    const q = new QueryCommand({
      TableName: dynamoTable,
      IndexName: "PatientPharmacyIndex",
      KeyConditionExpression: "NHSNumber = :n AND ODSCode = :o",
      ExpressionAttributeValues: {
        ":n": {S: update.PatientNHSNumber},
        ":o": {S: update.PharmacyODSCode}
      }
    })

    let result
    try {
      result = await docClient.send(q)
    } catch (err) {
      logger.error("Error querying DynamoDB", {error: err})
      throw err
    }

    const items = result.Items ?? []

    if (items.length === 0) {
      logger.debug(
        "No previous notification states. Notification allowed",
        {
          NHSNumber: update.PatientNHSNumber,
          ODSCode: update.PharmacyODSCode,
          requestID: update.RequestID
        }
      )
      return true
    }

    const timestamps = items
      .map(i => i.LastNotificationRequestTimestamp?.S)
      .filter((ts): ts is string => Boolean(ts)) // If we get some weird variable type, ignore it
      .map(ts => new Date(ts).getTime())

    if (!timestamps.length) {
      logger.debug(
        "No valid timestamps found in the returned records. " +
        "Assuming something is broken for this patient, and blocking notifications",
        {
          LastNotificationRequestTimestamps: items.map(i => i.LastNotificationRequestTimestamp?.S),
          NHSNumber: update.PatientNHSNumber,
          ODSCode: update.PharmacyODSCode,
          requestID: update.RequestID
        }
      )
      return false
    }

    // Compute seconds since last notification
    const lastTs = Math.max(...timestamps)
    const nowTs = Date.now()
    const secondsSince = Math.floor((nowTs - lastTs) / 1000)

    if (secondsSince > cooldownPeriod) {
      logger.debug("Cooldown period has passed. Notification allowed.", {
        NHSNumber: update.PatientNHSNumber,
        ODSCode: update.PharmacyODSCode,
        cooldownPeriod,
        secondsSince,
        requestID: update.RequestID
      })
      return true
    } else {
      logger.debug("Within cooldown period. Notification suppressed.", {
        NHSNumber: update.PatientNHSNumber,
        ODSCode: update.PharmacyODSCode,
        cooldownPeriod,
        secondsSince,
        requestID: update.RequestID
      })
      return false
    }
  } catch (err) {
    logger.error("Error checking cooldown state", {error: err})
    throw err
  }
}
