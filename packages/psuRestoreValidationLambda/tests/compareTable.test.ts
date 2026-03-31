import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import {beforeEach, describe, expect, it, vi, type Mocked} from "vitest"
import {Logger} from "@aws-lambda-powertools/logger"

const mockSend = vi.fn()
const mockDocumentClient = {
  send: mockSend
} as unknown as Mocked<DynamoDBDocumentClient>

const mockLogger: Partial<Logger> = {
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}

const SOURCE_ITEM = {
  LastModified: {S: "2024-08-19T16:11:13Z"},
  PrescriptionID: {S: "dummy_prescription"},
  TaskID: {S: "dummy_task"}
}

const {compareTables} = await import("../src/compareTable")

describe("Compare table function", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.resetAllMocks()
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
