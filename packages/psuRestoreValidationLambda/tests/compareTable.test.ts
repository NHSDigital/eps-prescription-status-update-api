import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {jest} from "@jest/globals"
import {Logger} from "@aws-lambda-powertools/logger"

const mockSend = jest.fn()
const mockDocumentClient = {
  send: mockSend
} as unknown as jest.Mocked<DynamoDBDocumentClient>

const mockLogger: Partial<Logger> = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}

const SOURCE_ITEM = {
  LastModified: {S: "2024-08-19T16:11:13Z"},
  PrescriptionID: {S: "dummy_prescription"},
  TaskID: {S: "dummy_task"}
}

const {compareTables} = await import("../src/compareTable")

describe("Compare table function", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function setupMockResponses(sourceItems: Array<any>, restoredItems?: Array<any>) {
    const responses = [
      {scan: "source_table"}, // describe table 1
      {scan: "restored table"}, // describe table 2
      {Items: sourceItems} // scan source table
    ]

    // Only push restored items if provided
    if (restoredItems !== undefined) {
      responses.push({Items: restoredItems}) // query restored table
    }

    responses.forEach(res => mockSend.mockImplementationOnce(() => res))
  }

  it("returns success when everything matches", async () => {
    setupMockResponses([SOURCE_ITEM], [SOURCE_ITEM])
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeTruthy()
  })

  it("returns failure when there is a difference", async () => {
    const modifiedItem = {
      ...SOURCE_ITEM,
      PrescriptionID: {S: "different_dummy_prescription"}
    }
    setupMockResponses([SOURCE_ITEM], [modifiedItem])
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeFalsy()
  })

  it("returns success when there is only a new record", async () => {
    const newItem = {
      LastModified: {S: `${new Date()}`},
      PrescriptionID: "dummy_prescription",
      TaskID: "dummy_task"
    }
    setupMockResponses([newItem]) // no restored table records
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeTruthy()
  })

  it("returns failure when no rows returned from restored table", async () => {
    setupMockResponses([SOURCE_ITEM], [])
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeFalsy()
  })
})
