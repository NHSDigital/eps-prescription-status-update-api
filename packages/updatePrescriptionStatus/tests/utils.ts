/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"

const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: JSON.stringify(body),
  headers: {"x-request-id": "test-request-id"},
  multiValueHeaders: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/",
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: "",
  pathParameters: null
})

export {generateMockEvent}
