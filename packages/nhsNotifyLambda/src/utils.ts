import {Logger} from "@aws-lambda-powertools/logger"
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb"

import {NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {v4} from "uuid"

const NOTIFY_API_BASE_URL = process.env.NOTIFY_API_BASE_URL
const NOTIFY_API_TOKEN = process.env.NOTIFY_API_TOKEN

const TTL_DELTA = 60 * 60 * 24 * 7 // Keep records for a week

const dynamoTable = process.env.TABLE_NAME
const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

// AWS clients
const sqs = new SQSClient({region: process.env.AWS_REGION})
const dynamo = new DynamoDBClient({region: process.env.AWS_REGION})
const docClient = DynamoDBDocumentClient.from(dynamo)

/**
 * Returns the original array, chunked in batches of up to <size>
 *
 * @param arr - Array to be chunked
 * @param size - The maximum size of each chunk. The final chunk may be smaller.
 * @returns - an (N+1) dimensional array
 */
function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

// This is an extension of the SQS message interface, which explicitly parses the PSUDataItem
export interface NotifyDataItemMessage extends Message {
  PSUDataItem: NotifyDataItem
}

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10),
 * logs them, and returns:
 *  - messages: the array of parsed NotifyDataItemMessage
 *  - isEmpty: true if the last receive returned fewer than 5 messages (or none),
 *             indicating the queue is effectively drained.
 */
export async function drainQueue(
  logger: Logger,
  maxTotal = 100
): Promise<{ messages: Array<NotifyDataItemMessage>; isEmpty: boolean }> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  const allMessages: Array<NotifyDataItemMessage> = []
  let receivedSoFar = 0
  let isEmpty = false
  let pollingIteration = 0

  while (receivedSoFar < maxTotal) {
    pollingIteration = pollingIteration + 1

    const toFetch = Math.min(10, maxTotal - receivedSoFar)
    const receiveCmd = new ReceiveMessageCommand({
      QueueUrl: sqsUrl,
      MaxNumberOfMessages: toFetch,
      WaitTimeSeconds: 20, // Use long polling to avoid getting empty responses when the queue is small
      MessageAttributeNames: [
        "MessageDeduplicationId",
        "MessageGroupId"
      ]
    })

    const {Messages} = await sqs.send(receiveCmd)

    // if the queue is now empty, then break the loop
    if (!Messages || Messages.length === 0) {
      isEmpty = true
      logger.info("No messages received; marking queue as empty", {pollingIteration})
      break
    }

    logger.info(
      "Received some messages from the queue. Parsing them...",
      {
        pollingIteration,
        MessageIDs: Messages.map((m) => m.MessageId)
      }
    )

    const parsedMessages: Array<NotifyDataItemMessage> = Messages.map((m) => {
      if (!m.Body) {
        logger.error("Failed to parse SQS message - aborting this notification processor check.", {offendingMessage: m})
        throw new Error(`Received an invalid SQS message. Message ID ${m.MessageId}`)
      }

      const parsedBody: NotifyDataItem = JSON.parse(m.Body)

      return {
        ...m,
        PSUDataItem: parsedBody
      }
    })
    allMessages.push(...parsedMessages)
    receivedSoFar += Messages.length

    // if the last batch of messages was small, then break the loop
    // This is to prevent a slow-loris style breakdown if the queue has
    // barely enough messages to keep the processors alive
    if (!Messages || Messages.length < 5) {
      isEmpty = true
      logger.info("Received a small number of messages. Considering the queue drained.", {batchLength: Messages.length})
      break
    }
  }

  logger.info(`In sum, retrieved ${allMessages.length} messages from SQS`)

  return {messages: allMessages, isEmpty}
}

/**
 * For each message given, delete it from the notifications SQS in batches of up to 10.
 * Throws an error if any batch fails, but previous batches will remain deleted.
 *
 * @param logger - the logging object
 * @param messages - The messages that were received from SQS, and are to be deleted.
 */
export async function clearCompletedSQSMessages(
  logger: Logger,
  messages: Array<Message>
): Promise<void> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  const batches = chunkArray(messages, 10)

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]
    const entries = batch.map((m) => ({
      Id: m.MessageId!,
      ReceiptHandle: m.ReceiptHandle!
    }))

    logger.info(`Deleting batch ${batchIndex + 1}/${batches.length}`, {
      batchSize: entries.length,
      messageIds: entries.map((e) => e.Id)
    })

    const deleteCmd = new DeleteMessageBatchCommand({
      QueueUrl: sqsUrl,
      Entries: entries
    })
    const delResult = await sqs.send(deleteCmd)

    if (delResult.Failed && delResult.Failed.length > 0) {
      logger.error("Some messages failed to delete in this batch", {failed: delResult.Failed})
      throw new Error(`Failed to delete ${delResult.Failed.length} messages from SQS`)
    }

    logger.info(`Successfully deleted SQS message batch ${batchIndex + 1}`, {
      result: delResult,
      messageIds: entries.map((e) => e.Id)
    })
  }
}

export interface LastNotificationStateType {
  NHSNumber: string
  ODSCode: string
  RequestId: string // x-request-id header
  MessageID: string // The SQS message ID
  LastNotifiedPrescriptionStatus: string
  DeliveryStatus: string
  NotifyMessageID: string // The UUID we got back from Notify for the submitted message
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number // DynamoDB expiration time (UNIX timestamp)
}

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
      MessageID: data.MessageId!,
      LastNotifiedPrescriptionStatus: data.PSUDataItem.Status,
      DeliveryStatus: "requested", // TODO: This needs to be handled for the case where notify fails.
      NotifyMessageID: v4(), // TODO: Dummy message ID
      LastNotificationRequestTimestamp: new Date().toISOString(),
      ExpiryTime: (Math.floor(+new Date() / 1000) + TTL_DELTA)
    }

    try {
      await docClient.send(new PutCommand({
        TableName: dynamoTable,
        Item: item
      }))
      logger.info("Upserted prescription")
    } catch (err) {
      logger.error("Failed to write to DynamoDB", {
        error: err
      })
      throw err
    }
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
  cooldownPeriod: number = 900
): Promise<boolean> {

  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  try {
    // Retrieve the last notification state for this patient/pharmacy combo
    const getCmd = new GetCommand({
      TableName: dynamoTable,
      Key: {
        NHSNumber: update.PatientNHSNumber,
        ODSCode: update.PharmacyODSCode
      }
    })
    const {Item} = await docClient.send(getCmd)

    // If no previous record, we're okay to send a notification
    if (!Item?.LastNotificationRequestTimestamp) {
      logger.info("No previous notification state found. Notification allowed.")
      return true
    }

    // Compute seconds since last notification
    const lastTs = new Date(Item.LastNotificationRequestTimestamp).getTime()
    const nowTs = Date.now()
    const secondsSince = Math.floor((nowTs - lastTs) / 1000)

    if (secondsSince > cooldownPeriod) {
      logger.info("Cooldown period has passed. Notification allowed.", {
        NHSNumber: update.PatientNHSNumber,
        ODSCode: update.PharmacyODSCode,
        cooldownPeriod,
        secondsSince
      })
      return true
    } else {
      logger.info("Within cooldown period. Notification suppressed.", {
        NHSNumber: update.PatientNHSNumber,
        ODSCode: update.PharmacyODSCode,
        cooldownPeriod,
        secondsSince
      })
      return false
    }
  } catch (err) {
    logger.error("Error checking cooldown state", {error: err})
    throw err
  }
}

export async function makeBatchNotifyRequest(
  logger: Logger,
  routingPlanId: string,
  data: Array<NotifyDataItem>
): Promise<void> {
  if (!NOTIFY_API_BASE_URL) throw new Error("NOTIFY_API_BASE_URL is not defined in the environment variables!")
  if (!NOTIFY_API_TOKEN) throw new Error("NOTIFY_API_TOKEN is not defined in the environment variables!")

  // Shared between all messages in this batch
  const messageBatchReference = v4()

  // Map the NotifyDataItems into the structure needed for notify
  const messages = data.map(item => ({
    messageReference: item.RequestID,
    recipient: {nhsNumber: item.PatientNHSNumber},
    originator: {odsCode: item.PharmacyODSCode},
    personalisation: {
      taskId: item.TaskID,
      status: item.Status
    }
  }))

  const body = {
    data: {
      type: "MessageBatch" as const,
      attributes: {
        routingPlanId,
        messageBatchReference,
        messages
      }
    }
  }

  const url = `${NOTIFY_API_BASE_URL}/v1/message-batches`

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NOTIFY_API_TOKEN}`
      },
      body: JSON.stringify(body)
    })

    if (!resp.ok) {
      const body = await resp.json()
      logger.error("Notify batch request failed", {
        status: resp.status,
        statusText: resp.statusText,
        body: body
      })
      throw new Error(`Notify batch request failed with HTTP ${resp.status}`)
    }
  } catch (err) {
    logger.error("Error sending notify batch", {error: err})
    throw err
  }
}
