import {CloudWatchLogsClient, FilterLogEventsCommand, FilteredLogEvent} from "@aws-sdk/client-cloudwatch-logs"
import type {Logger} from "@aws-lambda-powertools/logger"

import {LogSearchOptions, TermSearchResult} from "./types"

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
    logger.debug(
      "Got a response from the log events query",
      {resp}
    )

    if (resp.events && resp.events.length > 0) {
      events = events.concat(resp.events)
    }

    nextToken = resp.nextToken
    pageCount += 1

    // If nextToken is not given, then we are on the last page.
    if (!nextToken) break
  }

  logger.info("Returning events", {"events": `${events}`})

  return events
}

/**
 * Search a single log group for messages containing each of the given terms.
 * Returns a list of results keyed by the term.
 */
export async function searchLogGroupForStrings(
  logGroupNameOrArn: string,
  terms: Array<string>,
  logger: Logger,
  opts: LogSearchOptions = {}
): Promise<Array<TermSearchResult>> {
  const results: Array<TermSearchResult> = []

  for (const term of terms) {
    // Skip empty strings to avoid a very broad query
    if (!term || !term.trim()) {
      results.push({term, matches: []})
      continue
    }
    const matches = await searchLogGroupForString(logGroupNameOrArn, term, logger, opts)
    results.push({term, matches})
  }

  return results
}
