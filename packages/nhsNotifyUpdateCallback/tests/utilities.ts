/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"

export const X_REQUEST_ID = "43313002-debb-49e3-85fa-34812c150242"
export const APPLICATION_NAME = "test-app"

const DEFAULT_HEADERS = {"x-request-id": X_REQUEST_ID, "attribute-name": APPLICATION_NAME}

export const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: body,
  headers: DEFAULT_HEADERS,
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
})
