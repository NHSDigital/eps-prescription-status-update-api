import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import errorHandler from "@nhs/fhir-middy-error-handler"
import {functionWithLoggerPassedIn, functionWithOutLoggerPassedIn} from "./helper"

const logger = new Logger({serviceName: "status"})

/* eslint-disable  max-len */

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} _event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.info("This is a log before keys are added")
  logger.appendKeys({
    "x-request-id": event.headers["x-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.requestContext.requestId
  })
  logger.info("This is a log after keys have been added")

  logger.debug("This is a debug message")
  logger.info("This is an info message")
  logger.warn("This is a warn message")
  logger.error("This is an error message")
  logger.critical("This is a critical message")

  const objectToLog = {
    property_int: 1,
    property_string: "This is a string"
  }

  logger.debug("This shows how to log a whole object", {objectToLog})
  logger.debug("This shows how to log properties to the main log event", {
    custom_property_int: 2,
    custom_property_string: "this is another string"
  })

  logger.debug("This shows how to log a custom object made as part of the log event", {
    multiple_custom_properties: {
      custom_property_int: 2,
      custom_property_string: "this is another string"
    }
  })

  functionWithLoggerPassedIn(logger)
  functionWithOutLoggerPassedIn()
  const commitId = process.env.COMMIT_ID
  const versionNumber = process.env.VERSION_NUMBER

  const statusBody = {commitId: commitId, versionNumber: versionNumber}

  return {
    statusCode: 200,
    body: JSON.stringify(statusBody),
    headers: {
      "Content-Type": "application/health+json",
      "Cache-Control": "no-cache"
    }
  }
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(httpHeaderNormalizer())
  .use(
    inputOutputLogger({
      logger: (request) => {
        if (request.response) {
          logger.debug(request)
        } else {
          logger.info(request)
        }
      }
    })
  )
  .use(errorHandler({logger: logger}))
