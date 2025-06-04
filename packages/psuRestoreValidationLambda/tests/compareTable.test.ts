import {DynamoDBDocumentClient, PutCommand, GetCommand} from "@aws-sdk/lib-dynamodb"
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
const {compareTables} = await import("../src/compareTable")

describe("Compare table function", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  it("returns success when everything matches", async () => {
    mockSend
      .mockImplementationOnce(() => { // first describe table command
        return {scan: "source_table"}
      })
      .mockImplementationOnce(() => { // second describe table command
        return {scan: "restored table"}
      })
      .mockImplementationOnce(() => { // scan of source table
        return {Items: [
          {
            LastModified: {"S": "2024-08-19T16:11:13Z"},
            PrescriptionID: "dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
      .mockImplementationOnce(() => { // query of restored table
        return {Items: [
          {
            LastModified: {"S": "2024-08-19T16:11:13Z"},
            PrescriptionID: "dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeTruthy()
  })

  it("returns failure when there is a difference", async () => {
    mockSend
      .mockImplementationOnce(() => { // first describe table command
        return {scan: "source_table"}
      })
      .mockImplementationOnce(() => { // second describe table command
        return {scan: "restored table"}
      })
      .mockImplementationOnce(() => { // scan of source table
        return {Items: [
          {
            LastModified: {"S": "2024-08-19T16:11:13Z"},
            PrescriptionID: "dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
      .mockImplementationOnce(() => { // query of restored table
        return {Items: [
          {
            LastModified: {"S": "2024-08-19T16:11:13Z"},
            PrescriptionID: "not_a_dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeFalsy()
  })

  it("returns success when there is only a new record", async () => {
    mockSend
      .mockImplementationOnce(() => { // first describe table command
        return {scan: "source_table"}
      })
      .mockImplementationOnce(() => { // second describe table command
        return {scan: "restored table"}
      })
      .mockImplementationOnce(() => { // scan of source table
        return {Items: [
          {
            LastModified: {"S": `${new Date()}`},
            PrescriptionID: "dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeTruthy()
  })

  it("returns failure when no rows returned from restored table", async () => {
    mockSend
      .mockImplementationOnce(() => { // first describe table command
        return {scan: "source_table"}
      })
      .mockImplementationOnce(() => { // second describe table command
        return {scan: "restored table"}
      })
      .mockImplementationOnce(() => { // scan of source table
        return {Items: [
          {
            LastModified: {"S": "2024-08-19T16:11:13Z"},
            PrescriptionID: "dummy_prescription",
            TaskID: "dummy_task"
          }
        ]}
      })
      .mockImplementationOnce(() => { // query of restored table
        return {Items: []}
      })
    const result = await compareTables("table1", "table2", mockDocumentClient, mockLogger as Logger)
    expect(result).toBeFalsy()
  })
})
