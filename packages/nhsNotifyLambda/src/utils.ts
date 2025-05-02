import {Logger} from "@aws-lambda-powertools/logger"
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

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
export interface PSUDataItemMessage extends Message {
  PSUDataItem: PSUDataItem
}

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10),
 * logs them, and deletes them.
 */
export async function drainQueue(logger: Logger, maxTotal = 100): Promise<Array<PSUDataItemMessage>> {
  let receivedSoFar = 0
  const allMessages: Array<PSUDataItemMessage> = []

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

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
        "MessageGroupId",
        "SequenceNumber"
      ]
    })

    const {Messages} = await sqs.send(receiveCmd)

    // if the queue is now empty, then break the loop
    if (!Messages || Messages.length === 0) break

    logger.info(
      "Received some messages from the queue. Parsing them...",
      {
        pollingIteration,
        MessageIDs: Messages.map((m) => m.MessageId)
      }
    )

    const parsedMessages: Array<PSUDataItemMessage> = Messages.map((m) => {
      if (!m.Body) {
        logger.error("Failed to parse SQS message - aborting this notification processor check.", {offendingMessage: m})
        throw new Error(`Received an invalid SQS message. Message ID ${m.MessageId}`)
      }

      const parsedBody: PSUDataItem = JSON.parse(m.Body!) as PSUDataItem

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
      logger.info("Received a small number of messages. Considering the queue drained.", {batchLength: Messages.length})
      break
    }
  }

  return allMessages
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

    logger.info(`Successfully deleted batch ${batchIndex + 1}`, {
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
  PrescriptionStatus: string
  DeliveryStatus: string
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number // DynamoDB expiration time (UNIX timestamp)
}

export async function addPrescriptionMessagesToNotificationStateStore(
  logger: Logger,
  dataArray: Array<PSUDataItemMessage>
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
      PrescriptionStatus: data.PSUDataItem.Status,
      DeliveryStatus: "requested",
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
