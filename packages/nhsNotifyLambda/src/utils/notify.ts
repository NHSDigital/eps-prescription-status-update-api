import {Logger} from "@aws-lambda-powertools/logger"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import axios from "axios"
import axiosRetry from "axios-retry"
import {v4} from "uuid"

import {
  NotifyDataItemMessage,
  CreateMessageBatchRequest,
  CreateMessageBatchResponse,
  MessageBatchItem
} from "./types"
import {loadConfig} from "./ssm"
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
  if (!process.env.API_KEY_SECRET) {
    throw new Error("Environment configuration error")
  }

  const {makeRealNotifyRequests, notifyApiBaseUrlRaw} = await loadConfig()
  const apiKeyRaw = await getSecret(process.env.API_KEY_SECRET)

  if (!notifyApiBaseUrlRaw) throw new Error("NOTIFY_API_BASE_URL is not defined in the environment variables!")
  if (!apiKeyRaw) throw new Error("API_KEY is not defined in the environment variables!")

  // Just to be safe, trim any whitespace. Also, secrets may be bytes, so make sure it's a string
  const BASE_URL = notifyApiBaseUrlRaw.trim()
  const API_KEY = apiKeyRaw.toString().trim()

  // Early break for empty data
  if (data.length === 0) {
    return []
  }

  // Shared between all messages in this batch
  const messageBatchReference = v4()

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

  if (!makeRealNotifyRequests) {
    logger.info("Not doing real Notify requests. Simply waiting for some time and returning success on all messages")
    await new Promise(f => setTimeout(f, DUMMY_NOTIFY_DELAY_MS))

    // Map each input item to a "successful" NotifyDataItemMessage
    return data.map(item => {
      return {
        ...item,
        messageBatchReference,
        deliveryStatus: "silent running",
        notifyMessageId: v4() // Create a dummy UUID
      }
    })
  }

  logger.info("Making a request for notifications to NHS notify", {count: data.length, routingPlanId})

  // Create an axios instance configured for Notify
  const axiosInstance = axios.create({
    baseURL: BASE_URL,
    headers: {
      Accept: "*/*",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${API_KEY}`
    }
  })

  // Retry configuration for rate limiting
  const onAxiosRetry = (retryCount: number, error: unknown) => {
    logger.warn(`Call to notify failed - retrying. Retry count ${retryCount}`, {error})
  }

  // Axios-retry respects the `Retry-After` header
  axiosRetry(axiosInstance, {
    retries: 5,
    onRetry: onAxiosRetry
  })

  try {
    const resp = await axiosInstance.post<CreateMessageBatchResponse>("/v1/message-batches", body)

    if (resp.status === 201) {
      const returnedMessages = resp.data.data.attributes.messages
      logger.info("Requested notifications OK!", {
        messageBatchReference,
        messageReferences: messages.map(e => e.messageReference),
        deliveryStatus: "requested"
      })

      // Map each input item to a NotifyDataItemMessage, marking success and attaching the notify ID
      return data.map(item => {
        const match = returnedMessages.find(
          m => m.messageReference === item.messageReference
        )

        // SUCCESS
        return {
          ...item,
          messageBatchReference,
          deliveryStatus: match ? "requested" : "notify request failed",
          notifyMessageId: match?.id
        }
      })

    } else {
      logger.error("Notify batch request failed", {
        status: resp.status,
        statusText: resp.statusText,
        messageBatchReference,
        messageReferences: messages.map(e => e.messageReference),
        deliveryStatus: "notify request failed"
      })
      throw new Error("Notify batch request failed")
    }

  } catch (error) {
    logger.error("Notify batch request failed", {error})
    return data.map(item => ({
      ...item,
      deliveryStatus: "notify request failed",
      messageBatchReference,
      notifyMessageId: undefined
    }))
  }
}
