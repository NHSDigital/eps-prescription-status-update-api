import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import httpHeaderNormalizer from "@middy/http-header-normalizer"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"

import {NotificationQueryFilters, NotificationsRepository} from "./notificationsRepository"

const logger = new Logger({serviceName: "notificationsReporting"})

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({region: process.env.AWS_REGION}))
let cachedRepository: NotificationsRepository | undefined

const getDefaultRepository = (): NotificationsRepository => {
  cachedRepository ??= new NotificationsRepository(documentClient, process.env.TABLE_NAME ?? "")
  return cachedRepository
}

export const buildHandler = (repoProvider: () => NotificationsRepository) => {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    logger.appendKeys({
      "nhsd-correlation-id": event.headers["nhsd-correlation-id"],
      "x-request-id": event.headers["x-request-id"],
      "apigw-request-id": event.requestContext.requestId
    })

    const filters = normalizeFilters(event.queryStringParameters ?? {})

    if (!hasAnyFilter(filters)) {
      return buildResponse(400, {message: "Provide at least one of prescriptionId, nhsNumber or odsCode"})
    }

    try {
      const notifications = await repoProvider().fetch(filters)
      logger.info("Returning notification results", {
        hasNhsNumber: Boolean(filters.nhsNumber),
        odsCode: filters.odsCode,
        prescriptionIdProvided: Boolean(filters.prescriptionId),
        resultCount: notifications.length
      })
      return buildResponse(200, {
        count: notifications.length,
        filters: {
          prescriptionId: filters.prescriptionId ?? null,
          odsCode: filters.odsCode ?? null,
          nhsNumberProvided: Boolean(filters.nhsNumber)
        },
        notifications
      })
    } catch (error) {
      logger.error("Failed to retrieve notification records", {error})
      return buildResponse(500, {message: "Failed to fetch notification statuses"})
    }
  }
}

const normalizeFilters = (params: Record<string, string | undefined>): NotificationQueryFilters => {
  const trimmed = (value?: string | null) => {
    if (!value) return undefined
    const normalized = value.trim()
    return normalized.length ? normalized : undefined
  }

  return {
    prescriptionId: trimmed(params.prescriptionId),
    nhsNumber: trimmed(params.nhsNumber),
    odsCode: trimmed(params.odsCode)?.toUpperCase()
  }
}

const hasAnyFilter = (filters: NotificationQueryFilters): boolean => (
  Boolean(filters.prescriptionId) || Boolean(filters.nhsNumber) || Boolean(filters.odsCode)
)

const buildResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache"
  },
  body: JSON.stringify(body)
})

export const lambdaHandler = buildHandler(getDefaultRepository)

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(httpHeaderNormalizer())
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )

export {normalizeFilters, buildResponse}
