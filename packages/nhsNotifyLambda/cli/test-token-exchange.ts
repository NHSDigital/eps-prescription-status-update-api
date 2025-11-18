#!/usr/bin/env node

/**
 * CLI tool to test NHS Notify token exchange
 *
 * Usage:
 *   npm run cli:test-token
 *
 * Required environment variables:
 *   NOTIFY_API_BASE_URL - e.g., https://int.api.service.nhs.uk
 *   NOTIFY_API_KEY - API key for NHS Notify
 *   NOTIFY_PRIVATE_KEY - RSA private key (PEM format)
 *   NOTIFY_KID - Key ID
 */

import {Logger} from "@aws-lambda-powertools/logger"
import axios from "axios"
import axiosRetry from "axios-retry"
import {tokenExchange2} from "../src/utils/auth.js"

async function main() {
  const logger = initLogger()
  const {host, apiKey, kid, privateKey} = loadNotifyCreds(logger)
  const axiosInstance = initAxiosInst(host)

  logger.info("Testing token exchange", {
    host,
    apiKeyPrefix: apiKey.substring(0, 10) + "...",
    kid
  })

  try {
    // Perform token exchange
    const accessToken = await tokenExchange2(
      logger,
      axiosInstance,
      host,
      apiKey,
      privateKey,
      kid
    )

    logger.info("Token exchange successful!", {
      tokenPrefix: accessToken.substring(0, 20) + "...",
      tokenLength: accessToken.length
    })

    console.log("\n✅ SUCCESS!")
    console.log(`\nAccess Token (first 50 chars):\n${accessToken.substring(0, 50)}...`)
    console.log(`\nFull token length: ${accessToken.length} characters\n`)

    process.exit(0)

  } catch (error) {
    logger.error("Token exchange failed", {error})
    console.error("\n❌ FAILED!")
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

main()

function initAxiosInst(host: string) {
  const axiosInstance = axios.create({
    baseURL: host,
    timeout: 30000
  })

  // Add retry logic
  axiosRetry(axiosInstance, {
    retries: 2,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error)
          || error.response?.status === 429
          || error.response?.status === 500
    }
  })
  return axiosInstance
}

function initLogger() {
  return new Logger({
    serviceName: "token-exchange-cli",
    logLevel: "INFO"
  })
}

function loadNotifyCreds(logger: Logger) {
  const host = process.env.NOTIFY_API_BASE_URL
  const apiKey = process.env.NOTIFY_API_KEY
  const privateKey = process.env.NOTIFY_PRIVATE_KEY
  const kid = process.env.NOTIFY_KID

  if (!host) {
    logger.error("Missing required environment variable: NOTIFY_API_BASE_URL")
    process.exit(1)
  }

  if (!apiKey) {
    logger.error("Missing required environment variable: NOTIFY_API_KEY")
    process.exit(1)
  }

  if (!privateKey) {
    logger.error("Missing required environment variable: NOTIFY_PRIVATE_KEY")
    process.exit(1)
  }

  if (!kid) {
    logger.error("Missing required environment variable: NOTIFY_KID")
    process.exit(1)
  }
  return {host, apiKey, kid, privateKey}
}
