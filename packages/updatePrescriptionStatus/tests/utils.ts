/* eslint-disable @typescript-eslint/no-explicit-any */

import {APIGatewayProxyEvent} from "aws-lambda"

const TASK_ID_0 = "4d70678c-81e4-4ff4-8c67-17596fd0aa46"
const TASK_ID_1 = "0ae4daf3-f24b-479d-b8fa-b69e2d873b60"
const X_REQUEST_ID = "43313002-debb-49e3-85fa-34812c150242"
const DEFAULT_HEADERS = {"x-request-id": X_REQUEST_ID}

const TASK_VALUES = [
  {
    prescriptionID: "07A66F-A83008-1EEEA0",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "6989b7bd-8db6-428c-a593-4022e3044c00",
    id: TASK_ID_0,
    status: "in-progress",
    lastModified: "2023-09-11T10:11:12Z"
  },
  {
    prescriptionID: "480720-A83008-57FF06",
    nhsNumber: "9449304130",
    odsCode: "C9Z1O",
    lineItemID: "e3843418-1900-44a1-8f6a-bff8601893b8",
    id: TASK_ID_1,
    status: "in-progress",
    lastModified: "2023-09-11T10:11:12Z"
  }
]

const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: JSON.stringify(body),
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

function generateTask(index: number) {
  const values = TASK_VALUES[index]
  return {
    resource: {
      basedOn: [{identifier: {value: values.prescriptionID}}],
      for: {identifier: {value: values.nhsNumber}},
      owner: {identifier: {value: values.odsCode}},
      id: values.id,
      focus: {identifier: {value: values.lineItemID}},
      status: values.status,
      lastModified: values.lastModified
    }
  }
}

function generateBody(taskCount: number = 1) {
  const tasks = []
  for (let i = 0; i < taskCount; i++) {
    tasks.push(generateTask(i))
  }
  return {entry: tasks}
}

function generateExpectedItems() {
  const items = []
  for (const taskValues of TASK_VALUES) {
    items.push({
      LineItemID: {S: taskValues.lineItemID},
      PatientNHSNumber: {S: taskValues.nhsNumber},
      PharmacyODSCode: {S: taskValues.odsCode},
      PrescriptionID: {S: taskValues.prescriptionID},
      RequestID: {S: X_REQUEST_ID},
      TaskID: {S: taskValues.id},
      TerminalStatus: {S: taskValues.status},
      RequestMessage: {
        M: {
          basedOn: {
            L: [{M: {identifier: {M: {value: {S: taskValues.prescriptionID}}}}}]
          },
          focus: {M: {identifier: {M: {value: {S: taskValues.lineItemID}}}}},
          for: {M: {identifier: {M: {value: {S: taskValues.nhsNumber}}}}},
          id: {S: taskValues.id},
          owner: {M: {identifier: {M: {value: {S: taskValues.odsCode}}}}},
          status: {S: taskValues.status},
          lastModified: {S: taskValues.lastModified}
        }
      }
    })
  }
  return items
}

export {generateBody, generateExpectedItems, generateMockEvent, TASK_ID_0, TASK_ID_1}
