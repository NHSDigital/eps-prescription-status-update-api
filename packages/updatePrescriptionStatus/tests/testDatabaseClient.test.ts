import {
  expect,
  describe,
  it,
  jest
} from "@jest/globals"

import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
import {mockDynamoDBClient} from "./utils/testUtils"
import {Logger} from "@aws-lambda-powertools/logger"
import {marshall} from "@aws-sdk/util-dynamodb"

const {mockSend} = mockDynamoDBClient()
const {persistDataItems, getPreviousItem} = await import("../src/utils/databaseClient")

const logger = new Logger({serviceName: "updatePrescriptionStatus_TEST"})

describe("Unit test persistDataItems", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  it("when the conditional check fails, an error is thrown", async () => {
    const dataItems = [
      {
        LastModified: "2023-01-01T00:00:00Z",
        LineItemID: "LineItemID_1",
        PatientNHSNumber: "PatientNHSNumber_1",
        PharmacyODSCode: "PharmacyODSCode_1",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_1",
        Status: "Status_1",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_1",
        ApplicationName: "name",
        ExpiryTime: 10
      },
      {
        LastModified: "2023-01-02T00:00:00Z",
        LineItemID: "LineItemID_2",
        PatientNHSNumber: "PatientNHSNumber_2",
        PharmacyODSCode: "PharmacyODSCode_2",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_2",
        Status: "Status_2",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_2",
        ApplicationName: "name",
        ExpiryTime: 10
      }
    ]

    mockSend.mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
      }) as never
    )
    const loggerSpy = jest.spyOn(logger, "error")

    await expect(persistDataItems(dataItems, logger)).rejects.toThrow(
      new TransactionCanceledException({
        $metadata: {},
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
      }) as never
    )

    expect(loggerSpy).toHaveBeenCalledWith("DynamoDB transaction cancelled due to conditional check failure.", {
      reasons: [{Code: "ConditionalCheckFailedException"}]
    })
  })

  it("returns success when everything works", async () => {
    const dataItems = [
      {
        LastModified: "2023-01-01T00:00:00Z",
        LineItemID: "LineItemID_1",
        PatientNHSNumber: "PatientNHSNumber_1",
        PharmacyODSCode: "PharmacyODSCode_1",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_1",
        Status: "Status_1",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_1",
        ApplicationName: "name",
        ExpiryTime: 10
      },
      {
        LastModified: "2023-01-02T00:00:00Z",
        LineItemID: "LineItemID_2",
        PatientNHSNumber: "PatientNHSNumber_2",
        PharmacyODSCode: "PharmacyODSCode_2",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_2",
        Status: "Status_2",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_2",
        ApplicationName: "name",
        ExpiryTime: 10
      }
    ]

    const loggerSpy = jest.spyOn(logger, "error")

    const result = await persistDataItems(dataItems, logger)
    expect(result).toBe(true)
    expect(loggerSpy).not.toHaveBeenCalled()
  })

  it("call dynamo update twice when there is a large batch", async () => {
    const dataItem = {
      LastModified: "2023-01-01T00:00:00Z",
      LineItemID: "LineItemID_1",
      PatientNHSNumber: "PatientNHSNumber_1",
      PharmacyODSCode: "PharmacyODSCode_1",
      PrescriptionID: "PrescriptionID_1",
      RequestID: "RequestID_1",
      Status: "Status_1",
      TaskID: "TaskID_1",
      TerminalStatus: "TerminalStatus_1",
      ApplicationName: "name",
      ExpiryTime: 10
    }
    const dataItems = Array(150).fill(dataItem)

    const loggerSpy = jest.spyOn(logger, "error")

    const result = await persistDataItems(dataItems, logger)
    expect(result).toBe(true)
    expect(loggerSpy).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("returns false when there is a general error", async () => {
    const dataItems = [
      {
        LastModified: "2023-01-01T00:00:00Z",
        LineItemID: "LineItemID_1",
        PatientNHSNumber: "PatientNHSNumber_1",
        PharmacyODSCode: "PharmacyODSCode_1",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_1",
        Status: "Status_1",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_1",
        ApplicationName: "name",
        ExpiryTime: 10
      },
      {
        LastModified: "2023-01-02T00:00:00Z",
        LineItemID: "LineItemID_2",
        PatientNHSNumber: "PatientNHSNumber_2",
        PharmacyODSCode: "PharmacyODSCode_2",
        PrescriptionID: "PrescriptionID_1",
        RequestID: "RequestID_2",
        Status: "Status_2",
        TaskID: "TaskID_1",
        TerminalStatus: "TerminalStatus_2",
        ApplicationName: "name",
        ExpiryTime: 10
      }
    ]

    const loggerSpy = jest.spyOn(logger, "error")
    mockSend.mockRejectedValue(
      new Error("General error") as never
    )

    const result = await persistDataItems(dataItems, logger)
    expect(result).toBe(false)
    expect(loggerSpy).toHaveBeenCalled()
  })
})

describe("Unit test getPreviousItem", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  const initialItem = {
    LastModified: "2023-01-01T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "with pharmacy",
    TaskID: "previous-task-id",
    TerminalStatus: "ready to collect",
    ApplicationName: "Jim's Pills",
    ExpiryTime: 123
  }
  const previousItem = {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "with pharmacy",
    TaskID: "previous-task-id",
    TerminalStatus: "ready to collect",
    ApplicationName: "Jim's Pills",
    ExpiryTime: 123
  }
  const currentItem = {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "current-task-id",
    TerminalStatus: "ready to collect",
    ApplicationName: "Jim's Pills",
    ExpiryTime: 123
  }

  it("Should return previous state when there is one", async() => {
    mockSend.mockReturnValue(
      {
        Items: [
          marshall(previousItem)
        ]
      }
    )

    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: previousItem
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("Should return the most recent previous state when there are multiple previous", async() => {
    mockSend.mockReturnValue(
      {
        Items: [
          marshall(initialItem),
          marshall(previousItem)
        ]
      }
    )

    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: previousItem
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("Should call dynamo twice when there is pagination", async() => {
    mockSend
      .mockReturnValueOnce(
        {
          LastEvaluatedKey: "2023-01-02T00:00:00Z",
          Items: [
            marshall(initialItem)
          ]
        }
      )
      .mockReturnValue(
        {
          Items: [
            marshall(previousItem)
          ]
        }
      )

    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: previousItem
    })
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("Should return undefined when no items returned", async() => {
    mockSend
      .mockReturnValue(
        {
          Items: [
          ]
        }
      )

    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: undefined
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("Should return undefined and log error when there is an error", async() => {
    mockSend.mockRejectedValue("Something went wrong" as never)

    const loggerSpy = jest.spyOn(logger, "error")
    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: undefined
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(loggerSpy).toHaveBeenCalledWith("Error retrieving previous item status", {"error": "Something went wrong"})
  })

})
