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

const dynamoTable = process.env.TABLE_NAME
const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

// AWS clients
const sqs = new SQSClient({region: process.env.AWS_REGION})
const dynamo = new DynamoDBClient({region: process.env.AWS_REGION})
const docClient = DynamoDBDocumentClient.from(dynamo)

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10),
 * logs them, and deletes them.
 */
export async function drainQueue(logger: Logger, maxTotal = 100): Promise<Array<Message>> {
  let receivedSoFar = 0
  const allMessages: Array<Message> = []

  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

  while (receivedSoFar < maxTotal) {
    const toFetch = Math.min(10, maxTotal - receivedSoFar)
    const receiveCmd = new ReceiveMessageCommand({
      QueueUrl: sqsUrl,
      MaxNumberOfMessages: toFetch,
      WaitTimeSeconds: 0,
      VisibilityTimeout: 30
    })

    const {Messages} = await sqs.send(receiveCmd)

    // if the queue is now empty, then break the loop
    if (!Messages || Messages.length === 0) break

    allMessages.push(...Messages)
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
  messages: Array<Message>,
  logger: Logger
): Promise<void> {
  const deleteMessages = messages.map((m) => ({
    Id: m.MessageId!,
    ReceiptHandle: m.ReceiptHandle!
  }))

  const deleteCmd = new DeleteMessageBatchCommand({
    QueueUrl: sqsUrl,
    Entries: deleteMessages
  })
  const delResult = await sqs.send(deleteCmd)

  if (delResult.Failed) {
    logger.error("Some messages failed to delete", {failed: delResult.Failed})
    throw new Error("Failed to delete fetched messages from SQS")
  }
}

export async function addPrescriptionToNotificationStateStore(logger: Logger, dataArray: Array<PSUDataItem>) {
  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  logger.info("Pushing data to DynamoDB", {count: dataArray.length})

  for (const data of dataArray) {
    const item = {
      ...data,
      // TTL for the item.
      // Since we only care about notifications that happened within
      // the cooldown period, a day of storage is more than enough for
      // practical purposes. But:
      // TODO: Do we need to store this for longer for auditing and crisis resolution?
      ExpiryTime: 86400
    }

    try {
      await docClient.send(new PutCommand({
        TableName: dynamoTable,
        Item: item
      }))
      logger.info("Upserted prescription", {
        PrescriptionID: data.PrescriptionID,
        PatientNHSNumber: data.PatientNHSNumber
      })
    } catch (err) {
      logger.error("Failed to write to DynamoDB", {
        PrescriptionID: data.PrescriptionID,
        error: err
      })
      throw err
    }
  }
}
