import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import {getItemStatusUpdates} from "./dynamoDBclient"
import {MiddyErrorHandler} from "@PrescriptionStatusUpdate_common/middyErrorHandler"
import {InputData} from "./types"

const logger = new Logger({serviceName: "status"})

const errorResponseBody = {
  message: "A system error has occurred"
}

const errorResponse = {
  statusCode: 500,
  body: JSON.stringify(errorResponseBody),
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  }
}

const middyErrorHandler = new MiddyErrorHandler(errorResponse)

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

  logger.appendKeys({
    "x-request-id": event.headers["x-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.requestContext.requestId
  })

  const inputData: InputData = {
    prescriptionID: event.queryStringParameters?.prescriptionid,
    applicationName: event.headers["attribute-name"],
    odsCode: event.queryStringParameters?.odscode,
    nhsNumber: event.queryStringParameters?.nhsnumber,
    showAllSuppliers: event.headers["show-all-suppliers"],
    overrideApplicationName: event.headers["x-override-application-name"],
    exclusiveStartKeyPrescriptionID: event.headers["exclusivestartkey-prescriptionid"],
    exclusiveStartKeyTaskID: event.headers["exclusivestartkey-taskid"]
  }

  const result = {
    items: []
  }
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  }

  const MIN_RESULTS_RETURNED = 5
  const MAX_RESULTS_RETURNED = 15
  for (;;) {
    const maxResults = MAX_RESULTS_RETURNED - result.items.length
    inputData.maxResults = maxResults
    const queryResult = await getItemStatusUpdates(inputData, logger)

    result.items = result.items.concat(queryResult.Items)

    const moreResults = Boolean(queryResult.LastEvaluatedKey)
    const enoughResults = result.items.length >= MIN_RESULTS_RETURNED

    const shouldContinueQuery = moreResults && !enoughResults
    if (shouldContinueQuery) {
      continue
    }

    if (moreResults) {
      for (const key in queryResult.LastEvaluatedKey) {
        headers[`LastEvaluatedKey-${key}`] = queryResult.LastEvaluatedKey[key]
      }
    }
    break
  }

  return {
    statusCode: result.items.length > 0 ? 200 : 404,
    body: JSON.stringify(result),
    headers
  }
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(httpHeaderNormalizer())
  .use(middyErrorHandler.errorHandler({logger: logger}))
