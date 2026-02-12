import {
  expect,
  describe,
  it,
  afterEach,
  jest
} from "@jest/globals"

import {Logger} from "@aws-lambda-powertools/logger"

import {PSUDataItem} from "@psu-common/commonTypes"

import {PostDatedProcessingResult, PostDatedSQSMessageWithRecentDataItem} from "../src/types"
import {createMockPostModifiedDataItem} from "./testUtils"

type BusinessLogicModule = typeof import("../src/businessLogic")

const ORIGINAL_ENV = {...process.env}

async function loadBusinessLogic(
  envOverrides = {}
): Promise<BusinessLogicModule> {
  // Makes sure that the environment is set before import each time
  jest.resetModules()
  process.env = {...ORIGINAL_ENV, ...envOverrides}
  return import("../src/businessLogic")
}

function createPSURecord(overrides: Partial<PSUDataItem> = {}): PSUDataItem {
  const baseRecord: PSUDataItem = {
    LastModified: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    LineItemID: "line-item",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "RX123",
    RepeatNo: 0,
    RequestID: "req-123",
    Status: "ready to collect",
    TaskID: "task-123",
    TerminalStatus: "terminal",
    ApplicationName: "post-dated-tests",
    ExpiryTime: 0,
    PostDatedLastModifiedSetAt: "2026-01-01T00:00:00.000Z"
  }

  return {
    ...baseRecord,
    ...overrides
  }
}

function createMessage(
  overrides: Partial<PostDatedSQSMessageWithRecentDataItem> = {}
): PostDatedSQSMessageWithRecentDataItem {
  const prescData = createMockPostModifiedDataItem({})
  const baseMessage: PostDatedSQSMessageWithRecentDataItem = {
    MessageId: "msg-123",
    ReceiptHandle: "receipt-123",
    Body: JSON.stringify(prescData),
    Attributes: {

    },
    prescriptionData: prescData,
    // In theory, this should contain the record corresponding to prescData, but for testing purposes it's fine
    mostRecentRecord: createPSURecord()
  }

  return {
    ...baseMessage,
    ...overrides,
    prescriptionData: overrides.prescriptionData ?? baseMessage.prescriptionData,
    mostRecentRecord: Object.hasOwn(overrides, "mostRecentRecord")
      ? overrides.mostRecentRecord
      : baseMessage.mostRecentRecord
  }
}

afterEach(() => {
  process.env = {...ORIGINAL_ENV}
  jest.useRealTimers()
})

describe("businessLogic", () => {
  describe("getMostRecentRecord", () => {
    it("should return the record with the latest timestamp, when all records are post-dated", async () => {
      const {getMostRecentRecord} = await loadBusinessLogic()
      const records = [
        createPSURecord({
          LineItemID: "line-old",
          PostDatedLastModifiedSetAt: "2026-01-01T00:00:00.000Z",
          LastModified: "2026-01-02T00:00:00.000Z" // The time it's scheduled to mature
        }),
        createPSURecord({
          LineItemID: "line-new",
          PostDatedLastModifiedSetAt: "2026-01-01T12:00:00.000Z", // submitted 12 hours later
          LastModified: "2026-01-01T18:00:00.000Z" // but last modified is earlier
        })
      ]

      const result = getMostRecentRecord(records)

      expect(result.LineItemID).toBe("line-new")
    })

    it("Should return the latest record when only one record is post-dated", async () => {
      const {getMostRecentRecord} = await loadBusinessLogic()
      const records = [
        createPSURecord({ // post-dated record submitted first
          LineItemID: "line-old",
          PostDatedLastModifiedSetAt: "2026-01-01T00:00:00.000Z",
          LastModified: "2026-01-15T00:00:00.000Z" // The time it's scheduled to mature
        }),
        createPSURecord({ // contemporary record submitted second
          LineItemID: "line-new",
          PostDatedLastModifiedSetAt: undefined,
          LastModified: "2026-01-02T00:00:00.000Z" // The time the prescription was actually ready to collect
        })
      ]

      const result = getMostRecentRecord(records)

      expect(result.LineItemID).toBe("line-new")
    })

    it("should return the latest record when no records are post-dated", async () => {
      const {getMostRecentRecord} = await loadBusinessLogic()
      const records = [
        createPSURecord({
          LineItemID: "line-old",
          PostDatedLastModifiedSetAt: undefined,
          LastModified: "2026-01-01T00:00:00.000Z"
        }),
        createPSURecord({
          LineItemID: "line-new",
          PostDatedLastModifiedSetAt: undefined,
          LastModified: "2026-02-01T00:00:00.000Z"
        })
      ]

      const result = getMostRecentRecord(records)

      expect(result.LineItemID).toBe("line-new")
    })
  })

  describe("determineAction", () => {
    it("should remove messages that have no existing records", async () => {
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({mostRecentRecord: undefined})

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE)
    })

    it("should remove messages when the most recent record is not post-dated", async () => {
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({
        mostRecentRecord: createPSURecord({
          LineItemID: "line-no-post-date",
          PostDatedLastModifiedSetAt: undefined
        })
      })

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE)
    })

    it("should remove messages when the status is not notifiable", async () => {
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({
        mostRecentRecord: createPSURecord({
          Status: "dispensed",
          LineItemID: "line-not-notifiable"
        })
      })

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.REMOVE_FROM_PD_QUEUE)
    })

    it("should classify a message as immature when LastModified is in the future", async () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"))
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({
        mostRecentRecord: createPSURecord({
          LastModified: "2026-01-02T12:00:00.000Z",
          PostDatedLastModifiedSetAt: "2026-01-02T12:00:00.000Z",
          LineItemID: "line-future"
        })
      })

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.REPROCESS)
    })

    it("should classify a message as matured when LastModified is in the past", async () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date("2026-01-03T12:00:00.000Z"))
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({
        mostRecentRecord: createPSURecord({
          LastModified: "2026-01-02T12:00:00.000Z",
          PostDatedLastModifiedSetAt: "2026-01-02T12:00:00.000Z",
          LineItemID: "line-past"
        })
      })

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.FORWARD_TO_NOTIFICATIONS)
    })

    it("should use the provided most recent record when determining maturity", async () => {
      jest.useFakeTimers()
      jest.setSystemTime(new Date("2026-01-05T12:00:00.000Z"))
      const {determineAction} = await loadBusinessLogic()
      const logger = new Logger({serviceName: "post-dated-tests"})
      const message = createMessage({
        mostRecentRecord: createPSURecord({
          LineItemID: "line-new",
          LastModified: "2026-01-06T12:00:00.000Z",
          PostDatedLastModifiedSetAt: "2026-01-06T12:00:00.000Z",
          Status: "ready to collect"
        })
      })

      const result = determineAction(logger, message)

      expect(result).toBe(PostDatedProcessingResult.REPROCESS)
    })
  })
})
