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

const generateExpectedItem = (
  LineItemID: string,
  PatientNHSNumber: string,
  PharmacyODSCode: string,
  PrescriptionID: string,
  TaskID: string,
  TerminalStatus: string,
  LastModified: string
) => ({
  LineItemID: {S: LineItemID},
  PatientNHSNumber: {S: PatientNHSNumber},
  PharmacyODSCode: {S: PharmacyODSCode},
  PrescriptionID: {S: PrescriptionID},
  RequestID: {S: "test-request-id"},
  TaskID: {S: TaskID},
  TerminalStatus: {S: TerminalStatus},
  RequestMessage: {
    M: {
      basedOn: {
        L: [{M: {identifier: {M: {value: {S: PrescriptionID}}}}}]
      },
      focus: {M: {identifier: {M: {value: {S: LineItemID}}}}},
      for: {M: {identifier: {M: {value: {S: PatientNHSNumber}}}}},
      id: {S: TaskID},
      owner: {M: {identifier: {M: {value: {S: PharmacyODSCode}}}}},
      status: {S: TerminalStatus},
      lastModified: {S: LastModified}
    }
  }
})

export {generateExpectedItem, generateMockEvent}
