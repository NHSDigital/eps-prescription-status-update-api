import {APIGatewayProxyEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"

import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, UpdateCommand, QueryCommand} from "@aws-sdk/lib-dynamodb"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

import {createHmac, timingSafeEqual} from "crypto"

import {LastNotificationStateType} from "@PrescriptionStatusUpdate_common/commonTypes"

import {MessageStatusResponse} from "./types"

const APP_NAME_SECRET = process.env.APP_NAME_SECRET
const API_KEY_SECRET = process.env.API_KEY_SECRET

// Actual secret values
let APP_NAME: string | undefined
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
  if (!APP_NAME_SECRET) {
    throw new Error("APP_NAME_SECRET environment variable is not set.")
  }
  if (!API_KEY_SECRET) {
    throw new Error("API_KEY_SECRET environment variable is not set.")
  }

  // Fetch both secrets in parallel
  const [appNameValue, apiKeyValue] = await Promise.all([
    getSecret(APP_NAME_SECRET),
    getSecret(API_KEY_SECRET)
  ])

  if (
    appNameValue === undefined
    || apiKeyValue === undefined
    || appNameValue instanceof Uint8Array
    || apiKeyValue instanceof Uint8Array
    || !appNameValue?.toString()
    || !apiKeyValue?.toString()
  ) {
    throw new Error("Failed to get secret values from the AWS secret manager")
  }

  APP_NAME = appNameValue.toString()
  API_KEY = apiKeyValue.toString()

  // Check again to catch empty strings
  if (!appNameValue || !apiKeyValue) {
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
  const secretValue = `${APP_NAME}.${API_KEY}`
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

  return undefined
}

/**
 * For each incoming NHS Notify message-status callback,
 * find the matching record in DynamoDB by NotifyMessageID,
 * and update it with the new delivery status, timestamp, and channels.
 * Do that all in parallel.
 */
export async function updateNotificationsTable(
  logger: Logger,
  bodyData: MessageStatusResponse
): Promise<void> {
  // For each callback resource, return a promise
  const callbackPromises = bodyData.data.map(async (resource) => {
    const {messageId, messageStatus, timestamp} = resource.attributes

    // Query matching records
    let queryResult
    try {
      queryResult = await docClient.send(new QueryCommand({
        TableName: dynamoTable,
        IndexName: "NotifyMessageIDIndex",
        KeyConditionExpression: "NotifyMessageID = :nm",
        ExpressionAttributeValues: {
          ":nm": messageId
        }
      }))
    } catch (error) {
      logger.error("Error querying by NotifyMessageID", {messageId, error})
      throw error
    }

    const items = queryResult.Items as Array<LastNotificationStateType> ?? []
    if (items.length === 0) {
      logger.warn("No matching record found for NotifyMessageID. Counting this as a successful update.", {messageId})
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

    const newExpiry = Math.floor(Date.now() / 1000) + TTL_DELTA

    // For each match, update in parallel
    const updatePromises = items.map(async item => {
      const key = {
        NHSNumber: item.NHSNumber,
        RequestId: item.RequestId
      }
      try {
        await docClient.send(new UpdateCommand({
          TableName: dynamoTable,
          Key: key,
          UpdateExpression: [
            "SET DeliveryStatus = :ds",
            " , LastNotificationRequestTimestamp = :ts",
            " , ExpiryTime = :et"
          ].join(""),
          ExpressionAttributeValues: {
            ":ds": messageStatus,
            ":ts": timestamp,
            ":et": newExpiry
          }
        }))
        logger.info(
          "Updated notification state",
          {
            NotifyMessageID: item.NotifyMessageID,
            nhsNumber: item.NHSNumber,
            psuRequestId: item.RequestId,
            newStatus: messageStatus,
            newTimestamp: timestamp,
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

    // wait for all updates for this callback
    await Promise.all(updatePromises)
  })

  // wait for all callbacks to be processed
  await Promise.all(callbackPromises)
}
