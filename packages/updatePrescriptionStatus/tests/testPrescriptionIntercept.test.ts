import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  it,
  describe,
  jest,
  beforeEach
} from "@jest/globals"
import {
  DEFAULT_DATE,
  generateBody,
  generateExpectedItems,
  generateMockEvent,
  mockDynamoDBClient,
  TASK_VALUES
} from "./utils/testUtils"
import responseSingleItem from "../../specification/examples/response-single-item.json"
import {GetItemCommand, TransactionCanceledException, TransactWriteItemsCommand} from "@aws-sdk/client-dynamodb"

export const mockGetParametersByName = jest.fn(async () => {
  return {}
})

const mockInitiatedSSMProvider = {
  getParametersByName: mockGetParametersByName
}

jest.unstable_mockModule("@PrescriptionStatusUpdate_common/utilities", async () => ({
  initiatedSSMProvider: mockInitiatedSSMProvider
}))

const {mockSend} = mockDynamoDBClient()
process.env.ENVIRONMENT = "int"
/*
  Using task values 1 and 3 (Instead of 0 and 2) to test the interception when the test prescription
  is not the first in the bundle.
*/
process.env.TEST_PRESCRIPTIONS_1 = ["abc", TASK_VALUES[1].prescriptionID, "def"].join(",")
process.env.TEST_PRESCRIPTIONS_2 = ["abc", TASK_VALUES[3].prescriptionID, "def"].join(",")

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
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
    jest.resetAllMocks()
  })

  it("Return 500 and write to DynamoDB when test prescription 1 is submitted for the first time", async () => {
    const body = generateBody(2)
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems(2)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    expectGetItemCommand(TASK_VALUES[1].prescriptionID, TASK_VALUES[1].id)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))
  })

  it("Return 201 and doesn't write to DynamoDB when test prescription 1 is submitted for a second time", async () => {
    const body = generateBody(2)
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const first_submission_response: APIGatewayProxyResult = await handler(event, {})

    expect(first_submission_response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    setupExistingDynamoEntry()

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(loggerInfo).toHaveBeenCalledWith("Not first submission of INT test prescription 1, forcing 201")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing 201 response for INT test prescription 1")
    expect(JSON.parse(response.body).entry[0]).toEqual(responseSingleItem.entry[0])

    expectGetItemCommand(TASK_VALUES[1].prescriptionID, TASK_VALUES[1].id)
  })
})

describe("testPrescription2Intercept", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
    jest.resetAllMocks()
  })

  it("Return 500 and write to DynamoDB when test prescription 2 is submitted for the first time", async () => {
    const body = generateBody(4)
    body.entry = [body.entry[0], body.entry[3]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    let expectedItems = generateExpectedItems(4)
    expectedItems.input.TransactItems = [expectedItems.input.TransactItems[0], expectedItems.input.TransactItems[3]]

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
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
    body.entry = [body.entry[0], body.entry[3]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
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
    expect(JSON.parse(response.body).entry[2].response.outcome.issue[0].diagnostics).toEqual(
      "Request contains a task id and prescription id identical to a record already in the data store."
    )

    expectGetItemCommand(TASK_VALUES[3].prescriptionID, TASK_VALUES[3].id)
  })
})

describe("testPrescription3Intercept", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
    jest.resetAllMocks()
    // Set TEST_PRESCRIPTIONS_3 only for these tests
    process.env.TEST_PRESCRIPTIONS_3 = ["abc", TASK_VALUES[2].prescriptionID, "def"].join(",")
    // Clear the module cache so it re-reads the env var
    jest.resetModules()
  })

  afterEach(() => {
    // Clean up after each test to avoid affecting other test suites
    delete process.env.TEST_PRESCRIPTIONS_3
    // Clear module cache again to ensure clean state for other tests
    jest.resetModules()
  })

  it("Return 400 when test prescription 3 is submitted", async () => {
    const body = generateBody(3)
    // Only include entries 0, 1, and 2. Entry 2 contains TASK_VALUES[2] which matches TEST_PRESCRIPTIONS_3
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(400)
    expect(loggerInfo).toHaveBeenCalledWith(
      "Forcing error for INT test prescription. Simulating failure to write to database.")
  })
})

describe("testPrescription4Intercept", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
    jest.resetAllMocks()
    // Set TEST_PRESCRIPTIONS_4 only for these tests
    process.env.TEST_PRESCRIPTIONS_4 = ["abc", TASK_VALUES[2].prescriptionID, "def"].join(",")
    // Clear the module cache so it re-reads the env var
    jest.resetModules()
  })

  afterEach(() => {
    // Clean up after each test to avoid affecting other test suites
    delete process.env.TEST_PRESCRIPTIONS_4
    // Clear module cache again to ensure clean state for other tests
    jest.resetModules()
  })

  it("Return 400 when test prescription 4 is submitted", async () => {
    const body = generateBody(3)
    // Only include entries 0, 1, and 2. Entry 2 contains TASK_VALUES[2] which matches TEST_PRESCRIPTIONS_4
    const event: APIGatewayProxyEvent = generateMockEvent(body)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(429)
    expect(loggerInfo).toHaveBeenCalledWith(
      "Forcing error for INT test prescription. Simulating PSU capacity failure.")
  })
})
