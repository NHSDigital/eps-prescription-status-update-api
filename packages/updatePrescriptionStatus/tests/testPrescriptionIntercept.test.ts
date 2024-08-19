import {APIGatewayProxyEvent, APIGatewayProxyResult} from "aws-lambda"
import {
  expect,
  it,
  describe,
  jest
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
import {TransactionCanceledException} from "@aws-sdk/client-dynamodb"

const {mockSend, mockTransact, mockGetItem} = mockDynamoDBClient()
process.env.ENVIRONMENT = "int"
process.env.TEST_PRESCRIPTION_1 = TASK_VALUES[0].prescriptionID
process.env.TEST_PRESCRIPTION_2 = TASK_VALUES[1].prescriptionID

describe("testPrescription1Intercept", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(DEFAULT_DATE)
  })

  it("Return 500 and write to DynamoDB when test prescription 1 is submitted for the first time", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    expect(mockGetItem).toHaveBeenCalledTimes(1)
    expect(mockGetItem).toHaveBeenCalledWith({
      Key: {
        PrescriptionID: {S: TASK_VALUES[0].prescriptionID},
        TaskID: {S: TASK_VALUES[0].id}
      },
      TableName: "PrescriptionStatusUpdates"
    })

    expect(mockTransact).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))

    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("Return 201 and doesn't write to DynamoDB when test prescription 1 is submitted for a second time", async () => {
    const body = generateBody()
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const first_submission_response: APIGatewayProxyResult = await handler(event, {})

    expect(first_submission_response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith("First submission of INT test prescription 1, returning 500")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    mockGetItem.mockReset()
    mockSend.mockResolvedValueOnce(new Object({Item: "Some item"}) as never)
    mockSend.mockRejectedValueOnce(
      new TransactionCanceledException({
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        $metadata: {},
        CancellationReasons: [
          {
            Code: "ConditionalCheckFailed",
            Item: {
              TaskID: {S: "d70678c-81e4-6665-8c67-17596fd0aa87"}
            },
            Message: "The conditional request failed"
          }
        ]
      }) as never
    )

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(201)
    expect(loggerInfo).toHaveBeenCalledWith("Not first submission of INT test prescription 1, forcing 201")
    expect(loggerInfo).toHaveBeenCalledWith("Forcing 201 response for INT test prescription 1")
    expect(JSON.parse(response.body)).toEqual(responseSingleItem)

    expect(mockGetItem).toHaveBeenCalledTimes(1)
    expect(mockGetItem).toHaveBeenCalledWith({
      Key: {
        PrescriptionID: {S: TASK_VALUES[0].prescriptionID},
        TaskID: {S: TASK_VALUES[0].id}
      },
      TableName: "PrescriptionStatusUpdates"
    })
  })
})

describe("testPrescription2Intercept", () => {
  it("Return 500 and write to DynamoDB when test prescription 2 is submitted for the first time", async () => {
    const body = generateBody(2)
    body.entry = [body.entry[1]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith(
      "First submission of INT test prescription 2. Updating store then returning 500"
    )
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    expect(mockGetItem).toHaveBeenCalledTimes(1)
    expect(mockGetItem).toHaveBeenCalledWith({
      Key: {
        PrescriptionID: {S: TASK_VALUES[1].prescriptionID},
        TaskID: {S: TASK_VALUES[1].id}
      },
      TableName: "PrescriptionStatusUpdates"
    })

    expect(mockTransact).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining(expectedItems))

    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it("Return 409 when test prescription 2 is submitted for a second time", async () => {
    const body = generateBody(2)
    body.entry = [body.entry[1]]
    const event: APIGatewayProxyEvent = generateMockEvent(body)
    const expectedItems = generateExpectedItems()
    mockTransact.mockReturnValue(expectedItems)

    const {handler, logger} = await import("../src/updatePrescriptionStatus")
    const loggerInfo = jest.spyOn(logger, "info")
    const first_submission_response: APIGatewayProxyResult = await handler(event, {})

    expect(first_submission_response.statusCode).toEqual(500)
    expect(loggerInfo).toHaveBeenCalledWith(
      "First submission of INT test prescription 2. Updating store then returning 500"
    )
    expect(loggerInfo).toHaveBeenCalledWith("Forcing error for INT test prescription")

    mockGetItem.mockReset()
    mockSend.mockResolvedValueOnce(new Object({Item: "Some item"}) as never)
    mockSend.mockRejectedValueOnce(
      new TransactionCanceledException({
        message: "DynamoDB transaction cancelled due to conditional check failure.",
        $metadata: {},
        CancellationReasons: [
          {
            Code: "ConditionalCheckFailed",
            Item: {
              TaskID: {S: "d70678c-81e4-6665-8c67-17596fd0aa87"}
            },
            Message: "The conditional request failed"
          }
        ]
      }) as never
    )

    const response: APIGatewayProxyResult = await handler(event, {})

    expect(response.statusCode).toEqual(409)
    expect(loggerInfo).toHaveBeenCalledWith("Not first submission of INT test prescription 2, continuing")
    expect(JSON.parse(response.body).entry[1].response.outcome.issue[0].diagnostics).toEqual(
      "Request contains a task id and prescription id identical to a record already in the data store."
    )

    expect(mockGetItem).toHaveBeenCalledTimes(1)
    expect(mockGetItem).toHaveBeenCalledWith({
      Key: {
        PrescriptionID: {S: TASK_VALUES[1].prescriptionID},
        TaskID: {S: TASK_VALUES[1].id}
      },
      TableName: "PrescriptionStatusUpdates"
    })
  })
})
