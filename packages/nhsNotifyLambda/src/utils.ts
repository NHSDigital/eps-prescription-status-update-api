import {Logger} from "@aws-lambda-powertools/logger"
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"
// import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
// import {DynamoDBDocumentClient, PutCommand} from "@aws-sdk/lib-dynamodb"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

const dynamoTable = process.env.TABLE_NAME
const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

// AWS clients
const sqs = new SQSClient({region: process.env.AWS_REGION})
// const dynamo = new DynamoDBClient({region: process.env.AWS_REGION})
// const docClient = DynamoDBDocumentClient.from(dynamo)

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
      WaitTimeSeconds: 0,
      VisibilityTimeout: 30
    })

    const {Messages} = await sqs.send(receiveCmd)

    // FIXME: DELETE THIS
    logger.info("Messages received", {Messages})

    // if the queue is now empty, then break the loop
    if (!Messages || Messages.length === 0) break

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
  messages: Array<Message>,
  logger: Logger
): Promise<void> {
  if (!sqsUrl) {
    logger.error("Notifications SQS URL not configured")
    throw new Error("NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL not set")
  }

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

  logger.info("Successfully deleted messages from SQS", {result: delResult})
}

export interface LastNotificationStateType {
  RequestId: string // This is also the x-request-id header
  MessageID: string // The SQS message ID
  NHSNumber: string
  ODSCode: string
  PrescriptionStatus: string
  DeliveryStatus: string
  LastNotificationRequestTimestamp: Date
}

export async function addPrescriptionMessagesToNotificationStateStore(
  logger: Logger,
  dataArray: Array<PSUDataItemMessage>
) {
  if (!dynamoTable) {
    logger.error("DynamoDB table not configured")
    throw new Error("TABLE_NAME not set")
  }

  logger.info("Attempting to push data to DynamoDB", {count: dataArray.length, dataArray})

  // for (const data of dataArray) {
  //   const item: LastNotificationStateType = {
  //     ExpiryTime: 604800,
  //     MessageBatchReference: data.,
  //     MessageID: ,
  //     NHSNumber: ,
  //     ODSCode: ,
  //     PrescriptionStatus: ,
  //     DeliveryStatus: ,
  //     LastNotificationRequestTimestamp: ,
  //   }

  //   try {
  //     await docClient.send(new PutCommand({
  //       TableName: dynamoTable,
  //       Item: item
  //     }))
  //     logger.info("Upserted prescription")
  //   } catch (err) {
  //     logger.error("Failed to write to DynamoDB", {
  //       error: err
  //     })
  //     throw err
  //   }
  // }
}
