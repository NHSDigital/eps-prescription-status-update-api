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

  while (receivedSoFar < maxTotal) {
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
  }

  return allMessages
}

/**
 * For each message given, delete it from the notifications SQS. Throws an error if it fails
 *
 * @param messages - The messages that were received from SQS, and are to be deleted.
 * @param logger - the logging object
 */
export async function clearCompletedSQSMessages(
  logger: Logger,
  messages: Array<Message>
): Promise<void> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  const deleteMessages = messages.map((m) => ({
    Id: m.MessageId!,
    ReceiptHandle: m.ReceiptHandle!
  }))

  logger.info("Deleting the following messages from SQS", {messages: deleteMessages})

  const deleteCmd = new DeleteMessageBatchCommand({
    QueueUrl: sqsUrl,
    Entries: deleteMessages
  })
  const delResult = await sqs.send(deleteCmd)

  if (delResult.Failed) {
    logger.error("Some messages failed to delete", {failed: delResult.Failed})
    throw new Error("Failed to delete fetched messages from SQS")
  }

  logger.info("Successfully deleted messages from SQS", {result: delResult})
}

export interface LastNotificationStateType {
  NHSNumber: string
  ODSCode: string
  RequestId: string // This is also the x-request-id header
  MessageID: string // The SQS message ID
  PrescriptionStatus: string
  DeliveryStatus: string
  LastNotificationRequestTimestamp: string // ISO-8601 string
  ExpiryTime: number
}

export async function addPrescriptionMessagesToNotificationStateStore(
  logger: Logger,
  dataArray: Array<PSUDataItemMessage>
) {
  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  logger.info("Attempting to push data to DynamoDB", {count: dataArray.length})

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
