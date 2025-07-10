import {Logger} from "@aws-lambda-powertools/logger"
import {getSecret} from "@aws-lambda-powertools/parameters/secrets"
import axios from "axios"

import {SignJWT, importPKCS8} from "jose"
import {v4 as uuidv4} from "uuid"

/**
 * Exchange API key + JWT for a bearer token from NHS Notify.
 */
export async function tokenExchange(
  logger: Logger,
  host: string
): Promise<string> {
  const [apiKeyRaw, privateKeyRaw, kidRaw] = await Promise.all([
    getSecret(process.env.API_KEY_SECRET!),
    getSecret(process.env.PRIVATE_KEY_SECRET!),
    getSecret(process.env.KID_SECRET!)
  ])

  const API_KEY = apiKeyRaw?.toString().trim()
  const PRIVATE_KEY = privateKeyRaw?.toString()
  const KID = kidRaw?.toString().trim()

  if (!API_KEY || !PRIVATE_KEY || !KID) {
    throw new Error("Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager")
  }

  // create and sign the JWT
  const alg = "RS512"
  const now = Math.floor(Date.now() / 1000)
  const jti = uuidv4()

  const key = await importPKCS8(PRIVATE_KEY, alg)

  const jwt = await new SignJWT({
    sub: API_KEY,
    iss: API_KEY,
    jti,
    aud: `https://${host}/oauth2/token`
  })
    .setProtectedHeader({alg, kid: KID, typ: "JWT"})
    .setIssuedAt(now)
    .setExpirationTime(now + 60) // 1 minute (the token will be used immediately)
    .sign(key)

  logger.info("Exchanging JWT for access token", {host, jti})

  // Request the token
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: jwt
  })

  const resp = await axios.post(
    `https://${host}/oauth2/token`,
    params.toString(),
    {
      headers: {"Content-Type": "application/x-www-form-urlencoded"}
    }
  )

  if (resp.status !== 200 || !resp.data.access_token) {
    logger.error("Token exchange failed", {
      status: resp.status,
      body: resp.data
    })
    throw new Error("Failed to exchange token")
  }

  logger.info("Token exchange successful")
  return resp.data.access_token as string
}
