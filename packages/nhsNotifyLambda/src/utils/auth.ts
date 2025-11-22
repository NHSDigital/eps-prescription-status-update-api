import {Logger} from "@aws-lambda-powertools/logger"
import {AxiosInstance} from "axios"
import {SignJWT, importPKCS8} from "jose"

import {NotifySecrets} from "./secrets.js"

/**
 * Exchange API key + JWT for a bearer token from NHS Notify.
 */
export async function tokenExchange(
  logger: Logger,
  axiosInstance: AxiosInstance,
  host: string,
  notifySecrets: NotifySecrets
): Promise<string> {
  // create and sign the JWT
  const alg = "RS512"
  const now = Math.floor(Date.now() / 1000)
  const jti = crypto.randomUUID()

  const key = await importPKCS8(notifySecrets.privateKey, alg)

  const jwt = await new SignJWT({
    sub: notifySecrets.apiKey,
    iss: notifySecrets.apiKey,
    jti,
    aud: `${host}/oauth2/token`
  })
    .setProtectedHeader({alg, kid: notifySecrets.kid, typ: "JWT"})
    .setIssuedAt(now)
    .setExpirationTime(now + 60) // 1 minute
    .sign(key)

  logger.info("Exchanging JWT for access token", {jwt, host, jti})

  // Request the token
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: jwt
  })

  try {
    const resp = await axiosInstance.post(
      "/oauth2/token",
      params,
      {
        headers: {"Content-Type": "application/x-www-form-urlencoded"}
      }
    )
    if (!resp.data.access_token) throw new Error("No token in response")
    return resp.data.access_token

  } catch (error) {
    logger.error("Token exchange failed", {error})
    throw error
  }
}
