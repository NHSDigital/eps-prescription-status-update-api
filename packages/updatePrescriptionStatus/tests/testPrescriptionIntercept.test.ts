/* eslint-disable @typescript-eslint/no-explicit-any */
import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  it,
  describe,
  vi,
  beforeEach,
  afterEach
} from "vitest"
import {
  DEFAULT_DATE,
  FULL_URL_1,
  generateBody,
  generateExpectedItems,
  generateMockEvent,
  TASK_VALUES,
  getTestPrescriptions
} from "./utils/testUtils"
import {GetItemCommand, TransactionCanceledException, TransactWriteItemsCommand} from "@aws-sdk/client-dynamodb"

const {mockSend, mockGetParametersByName, mockInitiatedSSMProvider} = vi.hoisted(() => {
  const mockGetParametersByName = vi.fn(async () => ({}))
  return {
    mockSend: vi.fn(),
    mockGetParametersByName,
    mockInitiatedSSMProvider: {getParametersByName: mockGetParametersByName}
  }
})

export {mockGetParametersByName}

vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@aws-sdk/client-dynamodb")>()
  return {
    ...mod,
    DynamoDBClient: vi.fn().mockImplementation(() => ({send: mockSend}))
  }
})

vi.mock("@psu-common/utilities", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@psu-common/utilities")>()
  return {
    ...mod,
    initiatedSSMProvider: mockInitiatedSSMProvider,
    getTestPrescriptions: getTestPrescriptions
  }
})

process.env.ENVIRONMENT = "int"

function resetDynamoMock() {
  mockSend.mockClear()
  mockSend.mockImplementation(async () => ({}))
}

function setupExistingDynamoEntry() {
  mockSend.mockImplementation(async (command) => {
    if (command instanceof GetItemCommand) {
      return new Object({Item: "Some item"})
    } else if (command instanceof TransactWriteItemsCommand) {
      throw new TransactionCanceledException({
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        $metadata: {},
        CancellationReasons: [
          {
            Code: "ConditionalCheckFailed",
            Item: {
              TaskID: {S: "0ae4daf3-f24b-479d-b8fa-b69e2d873b60"}
            },
            Message: "The conditional request failed"
          }
        ]
      })
    }
  })
}

function expectGetItemCommand(prescriptionID: string, taskID: string) {
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
    input: {
      Key: {
        PrescriptionID: {S: prescriptionID},
        TaskID: {S: taskID}
      },
      TableName: "PrescriptionStatusUpdates"
    }
  }))
}

describe("testPrescription1Intercept", () => {
  beforeEach(async () => {
    vi.useFakeTimers().setSystemTime(DEFAULT_DATE)
    const {resetTestPrescriptions} = await import("../src/updatePrescriptionStatus")
    resetTestPrescriptions()
    resetDynamoMock()
    vi.clearAllMocks()
  })

  it("Return 500 and write to DynamoDB when test prescription 1 is submitted for the first time", async () => {
    const body = generateBody(2)
    // Only include entry for test prescription 1 (TASK_VALUES[1])
    body.entry = [body.entry[1]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    let expectedItems = generateExpectedItems(2)
    expectedItems.input.TransactItems = [expectedItems.input.TransactItems[1]]

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    expectGetItemCommand(TASK_VALUES[1].prescriptionID, TASK_VALUES[1].id)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))
  })

  it("Return 201 and doesn't write to DynamoDB when test prescription 1 is submitted for a second time", async () => {
    const body = generateBody(2)
    // Only include entry for test prescription 1 (TASK_VALUES[1])
    body.entry = [body.entry[1]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const first_submission_response: APIGatewayProxyResult = await handler(event, {})

    expect(first_submission_response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    setupExistingDynamoEntry()

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(loggerInfo).toHaveBeenCalledWith("Not first submission of INT test prescription 1, forcing 201")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing 201 response for INT test prescription 1")
    const responseBody = JSON.parse(response.body)
    expect(responseBody.entry[0].response.status).toEqual("201 Created")
    expect(responseBody.entry[0].fullUrl).toEqual(FULL_URL_1)

    expectGetItemCommand(TASK_VALUES[1].prescriptionID, TASK_VALUES[1].id)
  })
})

describe("testPrescription2Intercept", () => {
  beforeEach(async () => {
    vi.useFakeTimers().setSystemTime(DEFAULT_DATE)
    const {resetTestPrescriptions} = await import("../src/updatePrescriptionStatus")
    resetTestPrescriptions()
    resetDynamoMock()
    vi.clearAllMocks()
  })

  it("Return 500 and write to DynamoDB when test prescription 2 is submitted for the first time", async () => {
    const body = generateBody(4)
    // Only include entry for test prescription 2 (TASK_VALUES[3])
    body.entry = [body.entry[3]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    let expectedItems = generateExpectedItems(4)
    expectedItems.input.TransactItems = [expectedItems.input.TransactItems[3]]

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith(
      "First submission of INT test prescription 2. Updating store then returning 500"
    )
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    expectGetItemCommand(TASK_VALUES[3].prescriptionID, TASK_VALUES[3].id)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))
  })

  it("Return 409 when test prescription 2 is submitted for a second time", async () => {
    const body = generateBody(4)
    // Only include entry for test prescription 2 (TASK_VALUES[3])
    body.entry = [body.entry[3]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const first_submission_response: APIGatewayProxyResult = await handler(event, {})

    expect(first_submission_response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith(
      "First submission of INT test prescription 2. Updating store then returning 500"
    )
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    setupExistingDynamoEntry()

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(409)
    expect(loggerInfo).toHaveBeenCalledWith("Not first submission of INT test prescription 2, continuing")
    const responseBody = JSON.parse(response.body)
    // When a duplicate is detected, there might be multiple entries in the response
    // Find the entry with the duplicate error message
    const duplicateEntry = responseBody.entry.find((entry: any) =>
      entry.response?.outcome?.issue?.[0]?.diagnostics?.includes("task id and prescription id identical")
    )
    expect(duplicateEntry).toBeDefined()
    expect(duplicateEntry.response.outcome.issue[0].diagnostics).toEqual(
      "Request contains a task id and prescription id identical to a record already in the data store."
    )

    expectGetItemCommand(TASK_VALUES[3].prescriptionID, TASK_VALUES[3].id)
  })
})

describe("testPrescription3Intercept", () => {
  beforeEach(async () => {
    vi.useFakeTimers().setSystemTime(DEFAULT_DATE)
    vi.resetModules()
    const {resetTestPrescriptions} = await import("../src/updatePrescriptionStatus")
    resetTestPrescriptions()
    resetDynamoMock()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it("Return 400 when test prescription 3 is submitted", async () => {
    const body = generateBody(3)
    // Only include entries 0, 1, and 2. Entry 2 contains TASK_VALUES[2] which matches TEST_PRESCRIPTIONS_3
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(loggerInfo).toHaveBeenCalledWith(
      "Forcing error for INT test prescription. Simulating failure to write to database.")
  })
})

describe("testPrescription4Intercept", () => {
  beforeEach(async () => {
    vi.useFakeTimers().setSystemTime(DEFAULT_DATE)
    vi.resetModules()
    const {resetTestPrescriptions} = await import("../src/updatePrescriptionStatus")
    resetTestPrescriptions()
    resetDynamoMock()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it("Return 400 when test prescription 4 is submitted", async () => {
    const body = generateBody(1)
    // Entry 0 contains TASK_VALUES[0] which matches TEST_PRESCRIPTIONS_4
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = vi.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})
    console.log(response)
    expect(loggerInfo).toHaveBeenCalledWith(
      "Forcing error for INT test prescription. Simulating PSU capacity failure.")
    expect(response.statusCode).toEqual(429)
  })
})
