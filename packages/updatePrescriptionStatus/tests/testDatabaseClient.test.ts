import {
  expect,
  describe,
  it,
  vi,
  beforeEach
} from "vitest"

import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import {marshall} from "@aws-sdk/util-dynamodb"

const {mockSend} = vi.hoisted(() => ({mockSend: vi.fn()}))

vi.mock(
  "@aws-sdk/client-dynamodb",
  async (importOriginal: () => Promise<typeof import("@aws-sdk/client-dynamodb")>) => {
    const mod = await importOriginal()
    return {
      ...mod,
      DynamoDBClient: vi.fn().mockImplementation(() => ({send: mockSend}))
    }
  }
)

const {persistDataItems, getPreviousItem, rollbackDataItems} = await import("../src/utils/databaseClient")

const logger = new Logger({serviceName: "updatePrescriptionStatus_TEST"})

describe("Unit test persistDataItems", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.resetAllMocks()
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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
    const loggerSpy = vi.spyOn(logger, "error")

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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
        ExpiryTime: 10
      }
    ]

    const loggerSpy = vi.spyOn(logger, "error")

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
      ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
      ExpiryTime: 10
    }
    const dataItems = Array(150).fill(dataItem)

    const loggerSpy = vi.spyOn(logger, "error")

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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
        ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
        ExpiryTime: 10
      }
    ]

    const loggerSpy = vi.spyOn(logger, "error")
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
    vi.resetModules()
    vi.clearAllMocks()
    vi.resetAllMocks()
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
    ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
    ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
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
    ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
    ExpiryTime: 123
  }

  it("Should return previous state when there is one", async () => {
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

  it("Should return the most recent previous state when there are multiple previous", async () => {
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

  it("Should call dynamo twice when there is pagination", async () => {
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

  it("Should return undefined when no items returned", async () => {
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

  it("Should return undefined and log error when there is an error", async () => {
    mockSend.mockRejectedValue("Something went wrong" as never)

    const loggerSpy = vi.spyOn(logger, "error")
    const result = await getPreviousItem(currentItem, logger)
    expect(result).toEqual({
      current: currentItem,
      previous: undefined
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(loggerSpy).toHaveBeenCalledWith("Error retrieving previous item status", {"error": "Something went wrong"})
  })

})

describe("Unit test rollbackDataItems", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  const makeItem = (overrides = {}) => ({
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "LineItemID_1",
    PatientNHSNumber: "PatientNHSNumber_1",
    PharmacyODSCode: "PharmacyODSCode_1",
    PrescriptionID: "PrescriptionID_1",
    RequestID: "RID_MATCH",
    Status: "Status_1",
    TaskID: "TaskID_1",
    TerminalStatus: "TerminalStatus_1",
    ApplicationName: "name",
    ApplicationID: "550e8400-e29b-41d4-a716-446655440000",
    ExpiryTime: 10,
    ...overrides
  })

  it("deletes all items when RequestID matches", async () => {
    const items = [makeItem(), makeItem({PrescriptionID: "PrescriptionID_2", TaskID: "TaskID_2"})]

    // success for each conditioned delete
    mockSend.mockImplementation(async () => Promise.resolve())

    const loggerWarn = vi.spyOn(logger, "warn")
    const loggerError = vi.spyOn(logger, "error")

    const result = await rollbackDataItems(items, logger)
    expect(result).toBe(true)
    expect(loggerWarn).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("treats RequestID mismatch or missing item as safe skips", async () => {
    const items = [makeItem(), makeItem({PrescriptionID: "PrescriptionID_2"})]

    // First delete succeeds, second hits conditional check failure (skip it)
    mockSend
      .mockImplementationOnce(async () => Promise.resolve())
      .mockImplementationOnce(async () => Promise.reject(
        new TransactionCanceledException({
          $metadata: {},
          message: "Conditional check failed",
          CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
        })
      ))

    const loggerWarn = vi.spyOn(logger, "warn")
    const loggerError = vi.spyOn(logger, "error")

    const result = await rollbackDataItems(items, logger)
    expect(result).toBe(true) // still overall success (safe to skip)
    expect(loggerWarn).toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("returns false when an unexpected error occurs", async () => {
    const items = [makeItem()]

    mockSend.mockImplementationOnce(async () => Promise.reject(new Error("error")))

    const loggerError = vi.spyOn(logger, "error")

    const result = await rollbackDataItems(items, logger)
    expect(result).toBe(false)
    expect(loggerError).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("handles [success, conditional-failure, success] and still returns true", async () => {
    const items = [makeItem({TaskID: "A"}), makeItem({TaskID: "B"}), makeItem({TaskID: "C"})]

    mockSend
      .mockImplementationOnce(async () => Promise.resolve()) // A: delete ok
      .mockImplementationOnce(async () => Promise.reject( // B: condition failure -> skip
        new TransactionCanceledException({
          $metadata: {},
          message: "Conditional check failed",
          CancellationReasons: [{Code: "ConditionalCheckFailedException"}]
        })
      ))
      .mockImplementationOnce(async () => Promise.resolve()) // C: delete ok

    const loggerWarn = vi.spyOn(logger, "warn")
    const loggerError = vi.spyOn(logger, "error")

    const result = await rollbackDataItems(items, logger)
    expect(result).toBe(true)
    expect(loggerWarn).toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it("does not fail if there are zero items", async () => {
    const loggerWarn = vi.spyOn(logger, "warn")
    const loggerError = vi.spyOn(logger, "error")

    const result = await rollbackDataItems([], logger)
    expect(result).toBe(true)
    expect(loggerWarn).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(0)
  })
})
