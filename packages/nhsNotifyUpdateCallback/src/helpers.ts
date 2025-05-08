import {APIGatewayProxyEvent} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"

import {createHmac, timingSafeEqual} from "crypto"

const APP_NAME = process.env.APP_NAME ?? "NO-APP-NAME"
const API_KEY = process.env.API_KEY ?? "NO-API-KEY"

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

  // Compute the HMAC as a Buffer
  const expectedSigBuf = createHmac("sha256", secretValue)
    .update(payload, "utf8")
    .digest() // Buffer

  // Convert the incoming hex signature into a Buffer
  let givenSigBuf: Buffer
  try {
    givenSigBuf = Buffer.from(signature, "hex")
  } catch {
    logger.error("Invalid hex in signature header", {givenSignature: signature})
    return response(403, {message: "Malformed signature"})
  }

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
