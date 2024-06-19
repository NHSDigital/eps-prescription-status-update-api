import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import {errorHandler} from "./errorHandler"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import {getItemStatusUpdates} from "./dynamoDBclient"

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

  logger.appendKeys({
    "x-request-id": event.headers["x-request-id"],
    "x-correlation-id": event.headers["x-correlation-id"],
    "apigw-request-id": event.requestContext.requestId
  })

  const applicationName = event.headers["attribute-name"]
  const showAllSuppliers = event.headers["show-all-suppliers"]
  const overrideApplicationName = event.headers["x-override-application-name"]
  const exclusiveStartKeyPrescriptionID = event.headers["exclusivestartkey-prescriptionid"]
  const exclusiveStartKeyTaskID = event.headers["exclusivestartkey-taskid"]
  const odsCode = event.queryStringParameters?.odscode
  const nhsNumber = event.queryStringParameters?.nhsnumber
  const prescriptionID = event.queryStringParameters?.prescriptionid

  const queryResult = await getItemStatusUpdates(
    prescriptionID,
    applicationName,
    odsCode,
    nhsNumber,
    showAllSuppliers,
    overrideApplicationName,
    exclusiveStartKeyPrescriptionID,
    exclusiveStartKeyTaskID,
    logger
  )

  let statusCode = 200
  const result = {
    items: []
  }
  if (queryResult.Count === 0) {
    statusCode = 404
  } else {
    result.items = queryResult.Items
  }

  if (queryResult.LastEvaluatedKey) {
    result["LastEvaluatedKey"] = queryResult.LastEvaluatedKey
  }

  return {
    statusCode: statusCode,
    body: JSON.stringify(result),
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    }
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
  .use(errorHandler({logger: logger}))
