/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"
import {
  Channel,
  MessageStatusResource,
  MessageStatusResponse,
  RoutingPlan
} from "../src/types"

export const X_REQUEST_ID = "43313002-debb-49e3-85fa-34812c150242"
export const APPLICATION_NAME = "test-app"

const DEFAULT_HEADERS = {"x-request-id": X_REQUEST_ID, "attribute-name": APPLICATION_NAME}

export const generateMockEvent = (body: any = {}, headers: any = {}): APIGatewayProxyEvent => {
  const requestHeaders = {
    ...headers,
    ...DEFAULT_HEADERS
  }

  return {
    body: body,
    headers: requestHeaders,
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/callback",
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: "",
    pathParameters: null
  }
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Generates a mock MessageStatusResponse for testing, with optional deep overrides.
 * @param dataOverrides Array of partial resource overrides to apply (one per data item).
 * Defaults to a single default resource when omitted.
 */
export function generateMockMessageStatusResponse(
  dataOverrides: Array<DeepPartial<MessageStatusResource>> = [{}]
): MessageStatusResponse {
  const defaultRoutingPlan: RoutingPlan = {
    id: "plan-1",
    name: "Default Plan",
    version: "v1",
    createdDate: new Date().toISOString()
  }

  const defaultChannels: Array<Channel> = [
    {type: "nhsapp", channelStatus: "delivered"}
  ]

  const defaultResource: MessageStatusResource = {
    type: "MessageStatus",
    attributes: {
      messageId: "msg-123",
      messageReference: "ref-123",
      messageStatus: "delivered",
      channels: defaultChannels,
      timestamp: new Date().toISOString(),
      routingPlan: defaultRoutingPlan
    },
    links: {message: "/messages/msg-123"},
    meta: {idempotencyKey: "idem-123"}
  }

  const mergedData = dataOverrides.map((override) => {
    // Safely extract the nested attributes override or empty object
    const attrsOverride = override.attributes ?? {}

    // Merge channels deeply: map each partial override onto a default channel
    const mergedChannels: Array<Channel> = Array.isArray(attrsOverride.channels)
      ? attrsOverride.channels.map((ch) => ({
        ...defaultChannels[0],
        ...(ch as DeepPartial<Channel>)
      }))
      : defaultChannels

    const data: MessageStatusResource = {
      // Top-level merge: override type, links, meta if provided
      ...defaultResource,
      ...override,
      // Deep-merge attributes, ensuring correct types
      attributes: {
        ...defaultResource.attributes,
        ...attrsOverride,
        routingPlan: {
          ...defaultRoutingPlan,
          ...(attrsOverride.routingPlan as DeepPartial<RoutingPlan> ?? {})
        },
        channels: mergedChannels
      },
      // Deep-merge links and meta
      links: {...defaultResource.links, ...(override.links ?? {})},
      meta: {...defaultResource.meta, ...(override.meta ?? {})}
    }

    return data
  })

  return {data: mergedData}
}
