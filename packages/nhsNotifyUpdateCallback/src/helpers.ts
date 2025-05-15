import {APIGatewayProxyEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"

import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, UpdateCommand, QueryCommand} from "@aws-sdk/lib-dynamodb"

import {createHmac, timingSafeEqual} from "crypto"

import {MessageStatusResponse} from "./types"

const APP_NAME = process.env.APP_NAME
const API_KEY = process.env.API_KEY

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
 * Checks the incoming NHS Notify request signature.
 * If it's okay, returns undefined.
 * If it's not okay, it returns the error response object.
 */
export function checkSignature(logger: Logger, event: APIGatewayProxyEvent) {
  if (!APP_NAME) {
    throw new Error("APP_NAME environment variable is not set.")
  }
  if (!API_KEY) {
    throw new Error("API_KEY environment variable is not set.")
  }

  const signature = event.headers["x-hmac-sha256-signature"]
  if (!signature) {
    logger.error("No x-hmac-sha256-signature header given")
    return response(401, {message: "No x-hmac-sha256-signature given"})
  }

  const givenApiKey = event.headers["x-api-key"]
  if (!givenApiKey) {
    logger.error("No x-api-key header given")
    return response(401, {message: "No x-api-key header given"})
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

    const items = queryResult.Items ?? []
    if (items.length === 0) {
      logger.warn("No matching record found for NotifyMessageID", {messageId})
      return
    }
    if (items.length !== bodyData.data.length) {
      logger.warn("Not every received message update had a pre-existing record in the table.",
        {
          requestItemsLength: bodyData.data.length,
          tableQueryResultsLength: items.length
        }
      )
      // TODO: Elements without pre-existing records should have a new one created,
      // but we don't have enough information to do that :(
    }

    const newExpiry = Math.floor(Date.now() / 1000) + TTL_DELTA

    // For each match, update in parallel
    const updatePromises = items.map(async item => {
      const key = {
        NHSNumber: item.NHSNumber,
        ODSCode: item.ODSCode
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
