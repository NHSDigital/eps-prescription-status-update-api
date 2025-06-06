import {Logger} from "@aws-lambda-powertools/logger"
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  Message
} from "@aws-sdk/client-sqs"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, GetCommand, PutCommand} from "@aws-sdk/lib-dynamodb"
import {getParameter} from "@aws-lambda-powertools/parameters/ssm"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {NotifyDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

import {v4} from "uuid"
import {CreateMessageBatchRequest, CreateMessageBatchResponse, MessageBatchItem} from "./types"

// Dynamo TTL for entries
const TTL_DELTA = 60 * 60 * 24 * 14 // Keep records for 2 weeks

// For making the notify requests
const NOTIFY_REQUEST_MAX_ITEMS = 45000
const NOTIFY_REQUEST_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

// these are only ever changed by a deployment
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
// and helps track the nhs notify results
export interface NotifyDataItemMessage extends Message {
  PSUDataItem: NotifyDataItem
  success?: boolean
  notifyMessageId?: string
}

/**
 * Pulls up to `maxTotal` messages off the queue (in batches of up to 10) and bundles them together.
 * @param logger - The AWS logging object
 * @param maxTotal - The maximum number of messages to fetch. Guaranteed to be less than this.
 * @returns
 *  - messages the array of parsed NotifyDataItemMessage
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
  const seenDeduplicationIds = new Set<string>()
  let receivedSoFar = 0
  let isEmpty = false
  let pollingIteration = 0

  while (receivedSoFar < maxTotal) {
    pollingIteration = pollingIteration + 1

    const toFetch = Math.min(10, maxTotal - receivedSoFar)
    const receiveCmd = new ReceiveMessageCommand({
      QueueUrl: sqsUrl,
      MaxNumberOfMessages: toFetch,
      // Use long polling to avoid getting empty responses when the queue is small
      // If the queue is large enough to easily supply the requested number of messages,
      // the fetch does not wait the whole 20 seconds, so this is not a bottleneck for high
      // traffic periods.
      WaitTimeSeconds: 20,
      MessageSystemAttributeNames: ["MessageDeduplicationId"],
      MessageAttributeNames: ["All"]
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

    // flatmap causes the [] to be filtered out, since nothing is there to be flattened
    const parsedMessages: Array<NotifyDataItemMessage> = Messages.flatMap((m) => {
      if (!m.Body) {
        logger.error(
          "Received an invalid SQS message (missing Body) - omitting from processing.",
          {offendingMessage: m}
        )
        return []
      }
      try {
        const parsedBody: NotifyDataItem = JSON.parse(m.Body)
        // This is an array of one element, which will be extracted by the flatmap
        return [
          {
            ...m,
            PSUDataItem: parsedBody
          }
        ]
      } catch (error) {
        logger.error(
          "Failed to parse SQS message body as JSON - omitting from processing.",
          {offendingMessage: m, parseError: error}
        )
        return []
      }
    })

    // Ensure each message has a unique, populated deduplication ID
    // Where two messages have the same deduplication ID (i.e. they have the same
    // NHS number and ODS code), only keep the first one.
    // Note that this may happen for cases where the queue is not processed for over 5
    // minutes, and two updates are submitted for a patient after that time has passed.
    const uniqueMessages: Array<NotifyDataItemMessage> = []
    for (const msg of parsedMessages) {
      const dedupId = msg.Attributes?.MessageDeduplicationId
      if (!dedupId) {
        logger.error("SQS message missing MessageDeduplicationId. Skipping this message",
          {messageId: msg.MessageId, badMessage: msg})
        continue
      }
      if (seenDeduplicationIds.has(dedupId)) {
        logger.warn("Duplicate MessageDeduplicationId encountered; skipping duplicate",
          {messageId: msg.MessageId, deduplicationId: dedupId})
        continue
      }
      seenDeduplicationIds.add(dedupId)
      uniqueMessages.push(msg)
    }
    allMessages.push(...uniqueMessages)
    receivedSoFar += uniqueMessages.length

    // if the last batch of messages was small, then break the loop
    // This is to prevent a slow-loris style breakdown if the queue has
    // barely enough messages to keep the processors alive
    if (!Messages || Messages.length < 5) {
      isEmpty = true
      logger.info("Received a small number of messages. Considering the queue drained.", {batchLength: Messages.length})
      break
    }
  }

  logger.info(`In sum, retrieved ${allMessages.length} messages from SQS`,
    {MessageDeduplicationIds: allMessages.map(el => el.Attributes?.MessageDeduplicationId)}
  )

  return {messages: allMessages, isEmpty}
}

/**
 * For each message given, delete it from the notifications SQS in batches of up to 10.
 * If a batch fails to delete, the error is logged but execution continues.
 *
 * @param logger - the logging object
 * @param messages - The messages that were received from SQS, and are to be deleted.
 */
export async function removeSQSMessages(
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
    } else {
      logger.info(`Successfully deleted SQS message batch ${batchIndex + 1}`, {
        result: delResult,
        messageIds: entries.map((e) => e.Id)
      })
    }
  }
}

export interface LastNotificationStateType {
  NHSNumber: string
  ODSCode: string
  RequestId: string // x-request-id header
  SQSMessageID: string // The SQS message ID
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
      SQSMessageID: data.MessageId ?? "no SQS message ID",
      LastNotifiedPrescriptionStatus: data.PSUDataItem.Status,
      DeliveryStatus: data.success ? "requested" : "notify request failed",
      NotifyMessageID: data.notifyMessageId ?? "",
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

function estimateSize(obj: unknown) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8")
}

/**
 * Returns the original data, updated with the status returned by NHS notify.
 * Does not return data for messages that failed to send.
 *
 * @param logger AWS logging object
 * @param routingPlanId The Notify routing plan ID with which to process the data
 * @param data The details for the notification
 */
export async function makeBatchNotifyRequest(
  logger: Logger,
  routingPlanId: string,
  data: Array<NotifyDataItemMessage>
): Promise<Array<NotifyDataItemMessage>> {
  // Fetch secrets and parameters
  if (
    !process.env.NOTIFY_API_BASE_URL_PARAM
  || !process.env.API_KEY_SECRET
  ) {
    throw new Error("Environment configuration error")
  }

  logger.info("Getting parameters with these names",
    {NotifyApiBaseUrl: process.env.NOTIFY_API_BASE_URL, NotifyApiKey: process.env.API_KEY}
  )
  const NOTIFY_API_BASE_URL = await getParameter(process.env.NOTIFY_API_BASE_URL_PARAM)
  const API_KEY = await getSecret(process.env.API_KEY_SECRET)

  if (!NOTIFY_API_BASE_URL) throw new Error("NOTIFY_API_BASE_URL is not defined in the environment variables!")
  if (!API_KEY) throw new Error("API_KEY is not defined in the environment variables!")

  if (data.length === 0) {
    return []
  }

  logger.info("Fetched parameter values:", {NotifyUrl: NOTIFY_API_BASE_URL, ApiKey: API_KEY})

  // Shared between all messages in this batch
  const messageBatchReference = v4()

  // Map the NotifyDataItems into the structure needed for notify
  const messages: Array<MessageBatchItem> = data.flatMap(item => {
    // Ignore messages with missing deduplication IDs (the field is possibly undefined)
    if (!item.Attributes?.MessageDeduplicationId) {
      logger.error("NOT SENDING NOTIFY REQUEST FOR A MESSAGE; missing deduplication ID", {item})
      return []
    }
    // The message reference has to be unique for all messages in the batch.
    // The dedupe ID should work here.
    return [{
      messageReference: item.Attributes?.MessageDeduplicationId,
      recipient: {nhsNumber: item.PSUDataItem.PatientNHSNumber},
      originator: {odsCode: item.PSUDataItem.PharmacyODSCode},
      personalisation: {}
    }]
  })

  const body: CreateMessageBatchRequest = {
    data: {
      type: "MessageBatch" as const,
      attributes: {
        routingPlanId,
        messageBatchReference,
        messages
      }
    }
  }

  // Recursive split if too large
  if (data.length >= NOTIFY_REQUEST_MAX_ITEMS || estimateSize(body) > NOTIFY_REQUEST_MAX_BYTES) {
    logger.info("Received a large payload - splitting in half and trying again",
      {messageCount: data.length, estimatedSize: estimateSize(body)}
    )
    const mid = Math.floor(data.length / 2)
    const firstHalf = data.slice(0, mid)
    const secondHalf = data.slice(mid)
    // send both halves in parallel
    const [res1, res2] = await Promise.all([
      makeBatchNotifyRequest(logger, routingPlanId, firstHalf),
      makeBatchNotifyRequest(logger, routingPlanId, secondHalf)
    ])
    return [...res1, ...res2]
  }

  logger.info("Making a request for notifications to NHS notify", {count: data.length, routingPlanId})

  const url = `${NOTIFY_API_BASE_URL}/v1/message-batches`

  try {
    // TODO: Remove this
    logger.info("Making a Notification request with this body", {body, url, API_KEY})
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body)
    })

    if (resp.ok) {
      const respBody = (await resp.json()) as CreateMessageBatchResponse
      const returnedMessages = respBody.data.attributes.messages
      logger.info("Requested notifications OK!",
        {
          messageBatchReference,
          messageReferences: messages.map(e => e.messageReference),
          success: "Requested Success"
        }
      )

      // Map each input item to a NotifyDataItemMessage, marking success and attaching the notify ID
      return data.map(item => {
        const match = returnedMessages.find(
          m => m.messageReference === item.Attributes?.MessageDeduplicationId
        )

        return {
          PSUDataItem: item.PSUDataItem,
          success: !!match,
          notifyMessageId: match?.id
        }
      })

    } else if (resp.status === 425 || resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "30") * 1000
      logger.warn("Received rate limit; retrying after delay", {retryAfter})
      // When recursion is confirmed to be working, I'll uncomment this chunk. But not until I've checked it works!
      // await new Promise(resolve => setTimeout(resolve, retryAfter))
      // logger.info("Delay done, retrying now", {retryAfter})
      const newRequest = await makeBatchNotifyRequest(logger, routingPlanId, data)
      return newRequest

    } else {
      logger.error("Notify batch request failed", {
        status: resp.status,
        statusText: resp.statusText,
        responseBody: resp.body,
        messageBatchReference,
        messageReferences: messages.map(e => e.messageReference),
        success: "Requested Failed"
      })
      throw new Error("Notify batch request failed")
    }
  } catch (err) {
    logger.error("Error sending notify batch", {error: err})

    return data.map(item => ({
      PSUDataItem: item.PSUDataItem,
      success: false,
      notifyMessageId: undefined
    }))
  }
}
