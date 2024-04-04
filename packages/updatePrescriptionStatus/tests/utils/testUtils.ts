/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"
import {jest} from "@jest/globals"

import {
  LINE_ITEM_ID_CODESYSTEM,
  NHS_NUMBER_CODESYSTEM,
  ODS_CODE_CODESYSTEM,
  PRESCRIPTION_ID_CODESYSTEM,
  STATUS_CODESYSTEM
} from "../../src/validation/content"

export const TASK_ID_0 = "4d70678c-81e4-4ff4-8c67-17596fd0aa46"
export const TASK_ID_1 = "0ae4daf3-f24b-479d-b8fa-b69e2d873b60"
export const X_REQUEST_ID = "43313002-debb-49e3-85fa-34812c150242"
export const DEFAULT_DATE = new Date("2023-09-11T10:11:12Z")

const DEFAULT_HEADERS = {"x-request-id": X_REQUEST_ID}
const TABLE_NAME = "PrescriptionStatusUpdates"

const TASK_VALUES = [
  {
    prescriptionID: "07A66F-A83008-1EEEA0",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "6989b7bd-8db6-428c-a593-4022e3044c00",
    id: TASK_ID_0,
    status: "in-progress",
    businessStatus: "Dispatched",
    lastModified: "2023-09-11T10:11:12Z"
  },
  {
    prescriptionID: "480720-A83008-57FF06",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "e3843418-1900-44a1-8f6a-bff8601893b8",
    id: TASK_ID_1,
    status: "in-progress",
    businessStatus: "Ready to collect",
    lastModified: "2023-09-11T10:11:12Z"
  }
]

export const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: body,
  headers: DEFAULT_HEADERS,
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

export function generateEntry(index: number) {
  const values = TASK_VALUES[index]
  return {
    resource: {
      resourceType: "Task",
      lastModified: values.lastModified,
      focus: {identifier: {value: values.lineItemID, system: LINE_ITEM_ID_CODESYSTEM}},
      for: {identifier: {value: values.nhsNumber, system: NHS_NUMBER_CODESYSTEM}},
      owner: {identifier: {value: values.odsCode, system: ODS_CODE_CODESYSTEM}},
      basedOn: [{identifier: {value: values.prescriptionID, system: PRESCRIPTION_ID_CODESYSTEM}}],
      businessStatus: {coding: [{code: values.businessStatus, system: STATUS_CODESYSTEM}]},
      id: values.id,
      status: values.status
    }
  }
}

export function generateBody(taskCount: number = 1) {
  const entries = []
  for (let i = 0; i < taskCount; i++) {
    entries.push(generateEntry(i))
  }
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries
  }
}

export function generateExpectedItems(itemCount: number = 1) {
  const items = []
  for (let i = 0; i < itemCount; i++) {
    const values = TASK_VALUES[i]
    items.push({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          LastModified: {S: values.lastModified},
          LineItemID: {S: values.lineItemID},
          PatientNHSNumber: {S: values.nhsNumber},
          PharmacyODSCode: {S: values.odsCode},
          PrescriptionID: {S: values.prescriptionID},
          Status: {S: values.businessStatus},
          TaskID: {S: values.id},
          TerminalStatus: {S: values.status},
          RequestID: {S: X_REQUEST_ID},
          RequestMessage: {
            M: {
              resourceType: {S: "Task"},
              lastModified: {S: values.lastModified},
              focus: {M: {identifier: {M: {value: {S: values.lineItemID}, system: {S: LINE_ITEM_ID_CODESYSTEM}}}}},
              for: {M: {identifier: {M: {value: {S: values.nhsNumber}, system: {S: NHS_NUMBER_CODESYSTEM}}}}},
              owner: {M: {identifier: {M: {value: {S: values.odsCode}, system: {S: ODS_CODE_CODESYSTEM}}}}},
              basedOn: {L:
                [{M: {identifier: {M: {value: {S: values.prescriptionID}, system: {S: PRESCRIPTION_ID_CODESYSTEM}}}}}]},
              businessStatus: {M: {
                coding: {L: [{M: {code: {S: values.businessStatus}, system: {S: STATUS_CODESYSTEM}}}]}}},
              id: {S: values.id},
              status: {S: values.status}
            }
          }
        }
      }
    })
  }
  return {input: {TransactItems: items}}
}

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockInternalDependency(modulePath: string, module: object, dependency: string) {
  const mockDependency = jest.fn()
  jest.unstable_mockModule(modulePath, () => ({
    ...module,
    [dependency]: mockDependency
  }))
  return mockDependency
}

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockDynamoDBClient() {
  const mockSend = jest.fn()
  const mockTransact = jest.fn()
  jest.unstable_mockModule("@aws-sdk/client-dynamodb", () => {
    return {
      DynamoDBClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      })),
      TransactWriteItemsCommand: mockTransact
    }
  })
  return {mockSend, mockTransact}
}
