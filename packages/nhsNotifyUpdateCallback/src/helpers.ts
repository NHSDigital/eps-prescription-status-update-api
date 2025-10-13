import {APIGatewayProxyEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"

import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, UpdateCommand, QueryCommand} from "@aws-sdk/lib-dynamodb"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {createHmac, timingSafeEqual} from "crypto"

import {LastNotificationStateType} from "@PrescriptionStatusUpdate_common/commonTypes"

import {CallbackResource, CallbackResponse, CallbackType} from "./types"

const APP_ID_SECRET = process.env.APP_ID_SECRET
const API_KEY_SECRET = process.env.API_KEY_SECRET

// Actual secret values
let APP_ID: string | undefined
let API_KEY: string | undefined

// TTL is one week in seconds
const TTL_DELTA = 60 * 60 * 24 * 7

const dynamoTable = process.env.TABLE_NAME

const dynamo = new DynamoDBClient({region: process.env.AWS_REGION})
const docClient = DynamoDBDocumentClient.from(dynamo)

export function response(statusCode: number, body: unknown = {}) {
  return {
    statusCode,
    body: JSON.stringify(body)
  }
}

/**
 * Fetches all secret values from the AWS Secrets Manager
 */
export async function fetchSecrets(logger: Logger): Promise<void> {
  if (!APP_ID_SECRET) {
    throw new Error("APP_ID_SECRET environment variable is not set.")
  }
  if (!API_KEY_SECRET) {
    throw new Error("API_KEY_SECRET environment variable is not set.")
  }

  // Fetch both secrets in parallel
  const [appIdValue, apiKeyValue] = await Promise.all([
    getSecret(APP_ID_SECRET),
    getSecret(API_KEY_SECRET)
  ])

  if (
    appIdValue === undefined
    || apiKeyValue === undefined
    || appIdValue instanceof Uint8Array
    || apiKeyValue instanceof Uint8Array
    || !appIdValue?.toString()
    || !apiKeyValue?.toString()
  ) {
    throw new Error("Failed to get secret values from the AWS secret manager")
  }

  APP_ID = appIdValue.toString().trim()
  API_KEY = apiKeyValue.toString().trim()

  // Check again to catch empty strings
  if (!appIdValue || !apiKeyValue) {
    throw new Error("Failed to get secret values from the AWS secret manager")
  }

  logger.info("Fetched secrets OK")
}

/**
 * Checks the incoming NHS Notify request signature.
 * If it's okay, returns undefined.
 * If it's not okay, it returns the error response object.
 */
export async function checkSignature(logger: Logger, event: APIGatewayProxyEvent) {
  try {
    await fetchSecrets(logger)
  } catch (err) {
    logger.error("Failed to get secret values", {err})
    return response(500, "Internal Server Error")
  }

  const signature = event.headers["x-hmac-sha256-signature"]
  if (!signature) {
    logger.error("No x-hmac-sha256-signature header given")
    return response(401, {message: "No x-hmac-sha256-signature given"})
  }

  // Compute the HMAC-SHA256 hash of the combination of the request body and the secret value
  const secretValue = `${APP_ID}.${API_KEY}`
  const payload = event.body ?? ""

  // compare hashes as Buffers, rather than hex
  const expectedSigBuf = createHmac("sha256", secretValue)
    .update(payload, "utf8")
    .digest() // Buffer

  // Convert the incoming hex signature into a Buffer
  const givenSigBuf = Buffer.from(signature, "hex")

  // Must be same length for timingSafeEqual
  if (givenSigBuf.length !== expectedSigBuf.length ||
    !timingSafeEqual(expectedSigBuf, givenSigBuf)) {
    logger.error("Incorrect signature given", {
      expectedSignature: expectedSigBuf.toString("hex"),
      givenSignature: signature
    })
    return response(403, {message: "Incorrect signature"})
  }

  logger.info("Signature OK!")
  return undefined
}

export function extractStatusesAndDescriptions(logger: Logger, resource: CallbackResource) {
  let messageId: string | undefined
  let messageStatus: string | undefined
  let messageStatusDescription: string | undefined
  let channelStatus: string | undefined
  let channelStatusDescription: string | undefined
  let supplierStatus: string | undefined
  let retryCount: number | undefined
  let callbackTimestamp: string

  messageId = resource.attributes.messageId
  callbackTimestamp = resource.attributes.timestamp
  if (resource.type === CallbackType.message) {
    messageStatus = resource.attributes.messageStatus
    messageStatusDescription = resource.attributes.messageStatusDescription
    channelStatus = resource.attributes.channels?.[0]?.channelStatus // If missing, undefined
  } else if (resource.type === CallbackType.channel) {
    messageStatus = undefined
    retryCount = resource.attributes.retryCount
    channelStatus = resource.attributes.channelStatus
    channelStatusDescription = resource.attributes.channelStatusDescription
    supplierStatus = resource.attributes.supplierStatus
  } else {
    logger.error("Unknown data structure - cannot store to notifications table.", {resource})
    // Set to junk data, so that when we try and update the table we will fail. This is fine, and handled later.
    messageId = undefined
  }

  const statuses = {
    messageId,
    messageStatus,
    messageStatusDescription,
    channelStatus,
    channelStatusDescription,
    supplierStatus,
    retryCount,
    callbackTimestamp
  }
  let logPayload = {
    callbackType: resource.type,
    ...statuses
  }
  logger.info("Message state updated", logPayload)
  return statuses
}

/**
 * Helper for constructing the dynamo call.
 * Returns the UpdateExpression, and the accompanying objects for names and values.
 * If a field is undefined, it is not updated.
 *
 * @param updates: Records are keyed by the dynamo table field name, e.g. {Count: 5}. Undefined values are omitted.
 */
function buildUpdateExpression(updates: Record<string, unknown>) {
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const sets: Array<string> = []

  let i = 0
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue

    const name = `#n${i}`
    const val = `:v${i}`

    names[name] = key // avoid reserved word collisions
    values[val] = value
    sets.push(`${name} = ${val}`)

    i++
  }

  if (sets.length === 0) {
    // Dynamo doesn't allow empty set
    throw new Error("No defined fields provided for update")
  }

  return {
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values
  }
}

/**
 * For each incoming NHS Notify message-status callback,
 * find the matching record in DynamoDB by NotifyMessageID,
 * and update it with the new delivery status, timestamp, and channels.
 * Do that all in parallel.
 */
export async function updateNotificationsTable(
  logger: Logger,
  bodyData: CallbackResponse
): Promise<void> {
  // For each callback resource, return a promise
  const callbackPromises = bodyData.data.map(async (resource) => {
    const statuses = extractStatusesAndDescriptions(logger, resource)

    // prevent db hit
    if (!statuses.messageId) return

    // Query matching records
    let queryResult
    try {
      queryResult = await docClient.send(new QueryCommand({
        TableName: dynamoTable,
        IndexName: "NotifyMessageIDIndex",
        KeyConditionExpression: "NotifyMessageID = :nm",
        ExpressionAttributeValues: {
          ":nm": statuses.messageId
        }
      }))
    } catch (error) {
      logger.error("Error querying by NotifyMessageID", {messageId: statuses.messageId, error})
      throw error
    }

    const items = queryResult.Items as Array<LastNotificationStateType> ?? []
    if (items.length === 0) {
      logger.warn(
        "No matching record found for NotifyMessageID. Counting this as a successful update.",
        {messageId: statuses.messageId}
      )
      return
    }
    if (items.length !== bodyData.data.length) {
      logger.warn("Not every received message update had a pre-existing record in the table.",
        {
          requestItemsLength: bodyData.data.length,
          tableQueryResultsLength: items.length
        }
      )
      // Elements without pre-existing records should, in theory, have a new one created.
      // But we don't have enough information to do that so we ignore that edge case and
      // count it as a success.
    }
    const upToDateItems = filterOutOfDateItems(logger, resource, items)

    const newExpiry = Math.floor(Date.now() / 1000) + TTL_DELTA
    const updatePromises = upToDateItems.map(async item => {
      const key = {
        NHSNumber: item.NHSNumber,
        RequestId: item.RequestId
      }

      const updates = {
        // DynamoFieldName: Value | undefined
        ExpiryTime: newExpiry,
        LastNotificationRequestTimestamp: statuses.callbackTimestamp,
        MessageStatus: statuses.messageStatus,
        MessageStatusDescription: statuses.messageStatusDescription,
        ChannelStatus: statuses.channelStatus,
        ChannelStatusDescription: statuses.channelStatusDescription,
        SupplierStatus: statuses.supplierStatus,
        RetryCount: statuses.retryCount
      }

      const {UpdateExpression, ExpressionAttributeNames, ExpressionAttributeValues} = buildUpdateExpression(updates)

      try {
        await docClient.send(new UpdateCommand({
          TableName: dynamoTable,
          Key: key,
          UpdateExpression,
          ExpressionAttributeValues,
          ExpressionAttributeNames
        }))

        logger.info(
          "Updated notification state",
          {
            NotifyMessageID: item.NotifyMessageID,
            nhsNumber: item.NHSNumber,
            psuRequestId: item.RequestId,
            // The overall delivery status is whichever of
            // messageStatus or channelStatus is defined (prefer messageStatus)
            // TODO: Update the splunk query to use the below statuses
            deliveryStatus: statuses.messageStatus ?? statuses.channelStatus,
            // Parse to a string, or else undefined stuff doesn't get logged (thanks aws)
            messageStatus: `${statuses.messageStatus}`,
            channelStatus: `${statuses.channelStatus}`,
            supplierStatus: `${statuses.supplierStatus}`,
            newTimestamp: statuses.callbackTimestamp,
            newExpiryTime: newExpiry
          }
        )
      } catch (err) {
        logger.error(
          "Failed to update notification state",
          {
            NotifyMessageID: item.NotifyMessageID,
            nhsNumber: item.NHSNumber,
            psuRequestId: item.RequestId,
            error: err
          }
        )
      }
    })

    await Promise.all(updatePromises)
  })

  await Promise.all(callbackPromises)
}

function filterOutOfDateItems(
  logger: Logger,
  resource: CallbackResource,
  items: Array<LastNotificationStateType>
) {
  const upToDateItems = items.filter(item => {
    const isOld = item.LastNotificationRequestTimestamp &&
      item.LastNotificationRequestTimestamp > resource.attributes.timestamp
    if (isOld) {
      logger.warn(
        "Ignoring out-of-date callback",
        {
          messageId: resource.attributes.messageId,
          messageReference: resource.attributes.messageReference,
          lastTimestamp: item.LastNotificationRequestTimestamp,
          currentTimestamp: resource.attributes.timestamp
        }
      )
    }
    return !isOld
  })
  logger.info(
    "Number of up-to-date items remaining",
    {count: upToDateItems.length}
  )
  return upToDateItems
}
