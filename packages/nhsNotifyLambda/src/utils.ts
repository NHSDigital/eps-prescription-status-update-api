import {Logger} from "@aws-lambda-powertools/logger"
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"

const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

// The AWS_REGION is always defined in lambda environments
const sqs = new SQSClient({region: process.env.AWS_REGION})

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10),
 * logs them, and deletes them.
 */
export async function drainQueue(logger: Logger, maxTotal = 100) {
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

    // delete this batch of messages from the queue
    const deleteEntries = Messages.map((m) => ({
      Id: m.MessageId!,
      ReceiptHandle: m.ReceiptHandle!
    }))
    const deleteCmd = new DeleteMessageBatchCommand({
      QueueUrl: sqsUrl,
      Entries: deleteEntries
    })
    const delResult = await sqs.send(deleteCmd)

    if (delResult.Failed && delResult.Failed.length > 0) {
      logger.error("Some messages failed to delete", {failed: delResult.Failed})
      // TODO: Is this error handling logic in line with the business logic?
      // Or should this cause the whole thing to crash out?
    }
  }

  return allMessages
}
