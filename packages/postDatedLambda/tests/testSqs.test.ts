import {
  describe,
  it,
  expect,
  jest
} from "@jest/globals"
import {SpiedFunction} from "jest-mock"

import {Logger} from "@aws-lambda-powertools/logger"
import {LogItemMessage, LogItemExtraInput} from "@aws-lambda-powertools/logger/lib/cjs/types/Logger"
import * as sqs from "@aws-sdk/client-sqs"

export function mockSQSClient() {
  const mockSend = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-sqs", () => {
    return {
      ...sqs,
      SQSClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      }))
    }
  })
  return {mockSend}
}

const {mockSend} = mockSQSClient()

const {getQueueUrl, reportQueueStatus} = await import("../src/sqs")

const ORIGINAL_ENV = {...process.env}

describe("sqs", () => {
  let logger: Logger
  let infoSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  let errorSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>
  // let warnSpy: SpiedFunction<(input: LogItemMessage, ...extraInput: LogItemExtraInput) => void>

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Reset environment
    process.env = {...ORIGINAL_ENV}

    // Fresh logger and spies
    logger = new Logger({serviceName: "test-service"})
    infoSpy = jest.spyOn(logger, "info")
    errorSpy = jest.spyOn(logger, "error")
    // warnSpy = jest.spyOn(logger, "warn")
  })

  describe("getQueueUrl", () => {
    it("Should return the SQS queue URL from environment variables", () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      const result = getQueueUrl(logger)
      expect(result).toBe(testUrl)
    })

    it("Should throw an error if the SQS queue URL is not configured", () => {
      delete process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL

      expect(() => getQueueUrl(logger)).toThrow("POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL not set")
      expect(errorSpy).toHaveBeenCalledWith("Post-dated prescriptions SQS URL not configured")
    })
  })

  describe("reportQueueStatus", () => {
    it("Should report the current status of the SQS queue", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response
      mockSend.mockReturnValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: "5",
          ApproximateNumberOfMessagesNotVisible: "2",
          ApproximateNumberOfMessagesDelayed: "1"
        }
      })

      await reportQueueStatus(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith(
        "Current post-dated queue attributes (if a value failed to fetch, it will be reported as -1):",
        {
          ApproximateNumberOfMessages: 5,
          ApproximateNumberOfMessagesNotVisible: 2,
          ApproximateNumberOfMessagesDelayed: 1
        }
      )
    })

    it("Should handle missing attributes gracefully", async () => {
      const testUrl = "https://sqs.us-east-1.amazonaws.com/123456789012/test-queue"
      process.env.POST_DATED_PRESCRIPTIONS_SQS_QUEUE_URL = testUrl

      // Mock SQS response with missing attributes
      mockSend.mockReturnValueOnce({
        Attributes: {}
      })

      await reportQueueStatus(logger)

      expect(mockSend).toHaveBeenCalledTimes(1)
      expect(infoSpy).toHaveBeenCalledWith(
        "Current post-dated queue attributes (if a value failed to fetch, it will be reported as -1):",
        {
          ApproximateNumberOfMessages: -1,
          ApproximateNumberOfMessagesNotVisible: -1,
          ApproximateNumberOfMessagesDelayed: -1
        }
      )
    })
  })
})
