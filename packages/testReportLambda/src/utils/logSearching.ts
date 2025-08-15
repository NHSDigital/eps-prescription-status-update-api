import {CloudWatchLogsClient, FilterLogEventsCommand, FilteredLogEvent} from "@aws-sdk/client-cloudwatch-logs"
import type {Logger} from "@aws-lambda-powertools/logger"

import {LogSearchOptions, PrescriptionIdSearchResult} from "./types"

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

/**
 * Builds a filter pattern that matches any log message containing the exact term.
 * Using quotes in CloudWatch Logs filter patterns matches the literal substring anywhere in the message.
 */
export function buildExactSubstringFilter(term: string): string {
  // Escape any embedded quotes in the term by backslash-escaping
  const safe = term.replace(/"/g, '\\"')
  return `"${safe}"`
}

/**
 * Search a single log group for messages containing a single term.
 */
export async function searchLogGroupForString(
  logGroupName: string,
  term: string,
  logger: Logger,
  opts: LogSearchOptions = {}
): Promise<Array<FilteredLogEvent>> {
  const client = getClient()

  // Defaults
  const startTime = opts.startTime ?? Date.now() - 14 * 24 * 60 * 60 * 1000 // 14 days
  const endTime = opts.endTime ?? Date.now()
  const limitPerTerm = Math.max(1, opts.limitPerTerm ?? 1000)
  const pageLimit = Math.max(1, opts.pageLimit ?? 50)

  const filterPattern = buildExactSubstringFilter(term)

  let events: Array<FilteredLogEvent> = []
  let nextToken: string | undefined = undefined
  let pageCount = 0

  logger.info?.(
    `Searching log group for term`,
    {
      logGroupName,
      term,
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
      const parsedMessages = resp.events.map((e) => {
        return (e.message === undefined) ? {} : JSON.parse(e.message)
      })
      events = events.concat(parsedMessages)
    }

    nextToken = resp.nextToken
    pageCount += 1

    // If nextToken is not given, then we are on the last page.
    if (!nextToken) break
  }

  return events
}

/**
 * Search a single log group for messages containing each of the given terms.
 * Returns a list of results keyed by the term.
 */
export async function searchLogGroupForStrings(
  logGroupNameOrArn: string,
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

    const matches = await searchLogGroupForString(
      logGroupNameOrArn,
      prescriptionId,
      logger,
      opts
    )

    results.push({prescriptionId, matches})
  }

  return results
}
