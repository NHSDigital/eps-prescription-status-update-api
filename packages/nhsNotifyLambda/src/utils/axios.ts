import {Logger} from "@aws-lambda-powertools/logger"

import axios from "axios"
import axiosRetry from "axios-retry"

const RETRYABLE_CODES = [
  408,
  425,
  429,
  501,
  502,
  503,
  504,
  505,
  506,
  507,
  508,
  509,
  510,
  511
]

export function setupAxios(
  logger: Logger,
  notifyBaseUrl: string,
  requestTimeout: number = 30_000
): ReturnType<typeof axios.create> {
  const axiosInstance = axios.create({
    baseURL: notifyBaseUrl,
    timeout: requestTimeout,
    headers: {
      Accept: "*/*"
    }
  })

  // Retry configuration for transient failures and throttling
  const onAxiosRetry = (retryCount: number, error: unknown) => {
    logger.warn(`Call to notify failed - retrying. Retry count ${retryCount}`, {error})
  }

  const onFinalRetry = (error: unknown) => {
    logger.error("Call to notify failed, and retry budget exceeded. Stopping", {error})
  }

  axiosRetry(axiosInstance, {
    retries: 5,
    // exponential backoff honors Retry-After automatically if present
    retryDelay: axiosRetry.exponentialDelay,
    // IMPORTANT: Retry POSTs too — on network errors, 5xx, 429, or timeouts
    retryCondition: (error) => {
      const status = error.response?.status as number
      return RETRYABLE_CODES.includes(status)
    },
    onRetry: onAxiosRetry,
    onMaxRetryTimesExceeded: onFinalRetry,
    shouldResetTimeout: true
  })

  return axiosInstance
}
