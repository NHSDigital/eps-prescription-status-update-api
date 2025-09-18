import {CloudWatchLogsClient, FilterLogEventsCommand} from "@aws-sdk/client-cloudwatch-logs"
import type {Logger} from "@aws-lambda-powertools/logger"

import {
  LogSearchOptions,
  ParsedMessages,
  PrescriptionIdSearchResult,
  UpdatePrescriptionStatusLog
} from "./logSearchTypes"

// https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/cloudwatch-logs/
let _client: CloudWatchLogsClient | null = null

function getClient() {
  if (!_client) {
    _client = new CloudWatchLogsClient({
      region: process.env.AWS_REGION || "eu-west-2"
    })
  }
  return _client
}

export async function searchLogGroupForPrescriptionId(
  logGroupName: string,
  applicationName: string,
  prescriptionId: string,
  logger: Logger,
  opts: LogSearchOptions = {}
): Promise<ParsedMessages> {
  const client = getClient()

  // Defaults
  const startTime = opts.startTime ?? Date.now() - 14 * 24 * 60 * 60 * 1000 // 14 days
  const endTime = opts.endTime ?? Date.now()
  const limitPerTerm = Math.max(1, opts.limitPerTerm ?? 1000)
  const pageLimit = Math.max(1, opts.pageLimit ?? 50)

  prescriptionId = prescriptionId.trim().toUpperCase()

  // Build a JSON filter pattern that matches:
  // - message begins with the substring "[AEA-4318] - "
  // - applicationName
  // - prescriptionID
  //
  // Use JSON.stringify to escape arbitrary values.
  //
  // We really don't want them to be able to search for any old whatever in here.
  const filterPattern =
    `{ $.message = ${JSON.stringify("[AEA-4318] - *")} && ` +
    `$.appName = ${JSON.stringify(applicationName)} && ` +
    // FIXME: This needs to match against all relevant log messages
    `$.prescriptionID = ${JSON.stringify(prescriptionId)} }`

  let events: Array<UpdatePrescriptionStatusLog> = []
  let nextToken: string | undefined = undefined
  let pageCount = 0

  logger.info(
    `Searching log group for prescriptionId`,
    {
      logGroupName,
      supplierSystemName: applicationName,
      prescriptionId,
      startTime,
      endTime
    }
  )

  // https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_FilterLogEvents.html
  while (events.length < limitPerTerm && pageCount < pageLimit) {
    const pageLimitThisCall = Math.min(10000, limitPerTerm - events.length)

    const cmd: FilterLogEventsCommand = new FilterLogEventsCommand({
      logGroupName,
      startTime,
      endTime,
      filterPattern,
      nextToken,
      logStreamNames: opts.logStreamNames,
      limit: pageLimitThisCall
    })

    const resp = await client.send(cmd)

    if (resp.events && resp.events.length > 0) {
      const parsed: Array<UpdatePrescriptionStatusLog> = resp.events.flatMap((e) => {
        // Parses the message where it's found, skips if not.
        return e.message ? [JSON.parse(e.message)] : []
      })
      events = events.concat(parsed)
    }

    nextToken = resp.nextToken
    pageCount += 1

    // If nextToken is not given, then we are on the last page.
    if (!nextToken) break
  }

  return events
}

export async function searchLogGroupForPrescriptionIds(
  logGroupName: string,
  applicationName: string,
  prescriptionIds: Array<string>,
  logger: Logger,
  opts: LogSearchOptions = {}
): Promise<Array<PrescriptionIdSearchResult>> {
  const results: Array<PrescriptionIdSearchResult> = []

  for (const prescriptionId of prescriptionIds) {
    // Skip empty strings to avoid a very broad query
    if (!prescriptionId || !prescriptionId.trim()) {
      results.push({prescriptionId: prescriptionId, matches: []})
      continue
    }

    const matches = await searchLogGroupForPrescriptionId(
      logGroupName,
      applicationName,
      prescriptionId,
      logger,
      opts
    )

    results.push({prescriptionId, matches})
  }

  return results
}
