import {Logger} from "@aws-lambda-powertools/logger"

import axios from "axios"

import {setupAxios} from "./axios"
import {
  NotifyDataItemMessage,
  CreateMessageBatchRequest,
  CreateMessageBatchResponse,
  MessageBatchItem
} from "./types"
import {loadConfig} from "./ssm"
import {tokenExchange} from "./auth"
import {NOTIFY_REQUEST_MAX_BYTES, NOTIFY_REQUEST_MAX_ITEMS, DUMMY_NOTIFY_DELAY_MS} from "./constants"

/**
 * Returns the original array, chunked in batches of up to <size>
 *
 * @param arr - Array to be chunked
 * @param size - The maximum size of each chunk. The final chunk may be smaller.
 * @returns - an (N+1) dimensional array
 */
export function chunkArray<T>(arr: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function estimateSize(obj: unknown) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8")
}

/**
 * Handles making requests to NHS Notify for a batch of messages.
 * Decides whether to make real requests or fake ones based on config.
 * @param logger
 * @param routingPlanId - The Notify routing plan ID with which to process the data
 * @param data - PSU SQS messages to process
 * @returns
 */
export async function handleNotifyRequests(
  logger: Logger,
  routingPlanId: string,
  data: Array<NotifyDataItemMessage>
): Promise<Array<NotifyDataItemMessage>> {

  // Early break for empty data
  if (data.length === 0) {
    return []
  }

  const configPromise = loadConfig()

  // Map the NotifyDataItems into the structure needed for notify
  const messages: Array<MessageBatchItem> = data.flatMap(item => {
    // Ignore messages with missing deduplication IDs (the field is possibly undefined)
    if (!item.Attributes?.MessageDeduplicationId) {
      logger.error("NOT SENDING NOTIFY REQUEST FOR A MESSAGE; missing deduplication ID", {item})
      return []
    }

    return [{
      messageReference: item.messageReference,
      recipient: {nhsNumber: item.PSUDataItem.PatientNHSNumber},
      originator: {odsCode: item.PSUDataItem.PharmacyODSCode},
      personalisation: {}
    }]
  })

  // Check if we should make real requests
  const {makeRealNotifyRequestsFlag, notifyApiBaseUrlRaw} = await configPromise
  if (!makeRealNotifyRequestsFlag || !notifyApiBaseUrlRaw) return await makeFakeNotifyRequest(logger, data, messages)

  if (!notifyApiBaseUrlRaw) throw new Error("NOTIFY_API_BASE_URL is not defined in the environment variables!")
  // Just to be safe, trim any whitespace. Also, secrets may be bytes, so make sure it's a string
  const notifyBaseUrl = notifyApiBaseUrlRaw.trim()

  return await makeRealNotifyRequest(logger, routingPlanId, notifyBaseUrl, data, messages)
}

/**
 * Simulates making requests to NHS Notify for a batch of messages.
 * Waits a short time, then returns "successful" responses for all messages.
 */
async function makeFakeNotifyRequest(
  logger: Logger,
  data: Array<NotifyDataItemMessage>,
  messages: Array<MessageBatchItem>
): Promise<Array<NotifyDataItemMessage>> {

  logger.info("Not doing real Notify requests. Simply waiting for some time and returning success on all messages")
  await new Promise(f => setTimeout(f, DUMMY_NOTIFY_DELAY_MS))

  const messageStatus = "silent running"
  const messageBatchReference = crypto.randomUUID()

  logger.info("Requested notifications OK!", {
    messageBatchReference,
    messageReferences: messages.map(e => ({
      nhsNumber: e.recipient.nhsNumber,
      messageReference: e.messageReference,
      psuRequestId: data.find((el) => el.messageReference === e.messageReference)?.PSUDataItem.RequestID
    })),
    messageStatus: messageStatus
  })

  // Map each input item to a "successful" NotifyDataItemMessage
  return data.map(item => {
    return {
      ...item,
      messageBatchReference,
      messageStatus,
      notifyMessageId: crypto.randomUUID() // Create a dummy UUID
    }
  })
}

/**
 * Makes real requests to NHS Notify for a batch of messages.
 * Handles splitting large batches into smaller ones as needed.
 *
 * @param logger - AWS logging object
 * @param routingPlanId - The Notify routing plan ID with which to process the data
 * @param data - The details for the notification
 */
export async function makeRealNotifyRequest(
  logger: Logger,
  routingPlanId: string,
  notifyBaseUrl: string,
  data: Array<NotifyDataItemMessage>,
  messages: Array<MessageBatchItem>,
  bearerToken?: string,
  axiosInstance?: ReturnType<typeof axios.create>
): Promise<Array<NotifyDataItemMessage>> {

  // Shared between all messages in this batch
  const messageBatchReference = crypto.randomUUID()

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

  // Lazily get the bearer token and axios instance, so we only do it once even if we recurse
  axiosInstance ??= setupAxios(logger, notifyBaseUrl)
  bearerToken ??= await tokenExchange(logger, axiosInstance, notifyBaseUrl)

  // Recursive split if too large
  if (messages.length >= NOTIFY_REQUEST_MAX_ITEMS || estimateSize(body) > NOTIFY_REQUEST_MAX_BYTES) {
    logger.info("Received a large payload - splitting in half and trying again",
      {messageCount: messages.length, estimatedSize: estimateSize(body)}
    )
    const mid = Math.floor(messages.length / 2)
    const firstHalf = messages.slice(0, mid)
    const secondHalf = messages.slice(mid)

    // send both halves in parallel
    const [res1, res2] = await Promise.all([
      makeRealNotifyRequest(logger, routingPlanId, notifyBaseUrl, data, firstHalf, bearerToken, axiosInstance),
      makeRealNotifyRequest(logger, routingPlanId, notifyBaseUrl, data, secondHalf, bearerToken, axiosInstance)
    ])
    return [...res1, ...res2]
  }

  logger.info("Making a request for notifications to NHS notify", {count: messages.length, routingPlanId})

  try {
    const headers = {
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${bearerToken}`
    }
    const resp = await axiosInstance.post<CreateMessageBatchResponse>(
      "/comms/v1/message-batches",
      body,
      {headers}
    )

    // From here is just logging stuff for reporting, and mapping the response back to the input data

    if (resp.status === 201) {
      logger.info("Requested notifications OK!", {
        messageBatchReference,
        messageReferences: messages.map(e => ({
          nhsNumber: e.recipient.nhsNumber,
          messageReference: e.messageReference,
          psuRequestId: data.find((el) => el.messageReference === e.messageReference)?.PSUDataItem.RequestID,
          pharmacyODSCode: e.originator.odsCode
        })),
        messageStatus: "requested"
      })

      // Map each input item to a NotifyDataItemMessage, marking success and attaching the notify ID.
      // Only return items that belong to *this* batch (so we handle recursive splits correctly).
      const batchRefs = new Set(messages.map(m => m.messageReference))
      const returnedByRef = new Map(
        resp.data.data.attributes.messages.map(m => [m.messageReference, m])
      )

      return data
        .filter(item => batchRefs.has(item.messageReference))
        .map(item => {
          const match = returnedByRef.get(item.messageReference)
          return {
            ...item,
            messageBatchReference,
            messageStatus: match ? "requested" : "notify request failed",
            notifyMessageId: match?.id
          }
        })

    } else {
      logger.error("Notify batch request failed", {
        status: resp.status,
        statusText: resp.statusText,
        messageBatchReference,
        messageReferences: messages.map(e => ({
          nhsNumber: e.recipient.nhsNumber,
          messageReference: e.messageReference,
          psuRequestId: data.find((el) => el.messageReference === e.messageReference)?.PSUDataItem.RequestID
        })),
        messageStatus: "notify request failed"
      })
      throw new Error("Notify batch request failed")
    }

  } catch (error) {
    logger.error("Notify batch request failed", {error})
    return data.map(item => ({
      ...item,
      messageStatus: "notify request failed",
      messageBatchReference,
      messageReferences: messages.map(e => ({
        nhsNumber: e.recipient.nhsNumber,
        messageReference: undefined,
        psuRequestId: data.find((el) => el.messageReference === e.messageReference)?.PSUDataItem.RequestID
      })),
      notifyMessageId: undefined
    }))
  }
}
