/* eslint-disable @typescript-eslint/no-explicit-any */
import {handler} from "../src/updatePrescriptionStatus"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {APIGatewayProxyEvent} from "aws-lambda"
import {mockClient} from "aws-sdk-client-mock"
// import exampleInCollectionLocker from "../../specification/examples/request-in-collection-locker.json"
// import exampleMultipleItems from "../../specification/examples/request-multiple-items.json"
// import exampleMissingFields from "../../specification/examples/request-missing-fields.json"

const generateMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: JSON.stringify(body),
  headers: {},
  multiValueHeaders: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/",
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: "",
  pathParameters: null // Add pathParameters property
})

describe("Unit test for app handler", () => {
  beforeEach(() => {
    mockClient(DynamoDBClient)
  })

  afterEach(() => {
    mockClient(DynamoDBClient).restore()
  })

  // it("should update data in DynamoDB and return success response", async () => {
  //   const response = await handler(
  //     generateMockEvent(exampleInCollectionLocker),
  //     {} as any
  //   )
  //   expect(response.statusCode).toBe(201)
  //   expect(JSON.parse(response.body!).entry.length).toBe(
  //     exampleInCollectionLocker.entry.length
  //   )
  // })

  // it("should update data in DynamoDB and return success response for multiple items", async () => {
  //   const response = await handler(
  //     generateMockEvent(exampleMultipleItems),
  //     {} as any
  //   )
  //   expect(response.statusCode).toBe(201)
  //   expect(JSON.parse(response.body!).entry.length).toBe(
  //     exampleMultipleItems.entry.length
  //   )
  // })

  it("should return 400 status code and error message if request body is invalid JSON", async () => {
    const requestBody = "invalid JSON"
    const response = await handler(
      generateMockEvent(requestBody),
      {} as any
    )
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body!)).toEqual({
      error: "Missing required fields"
    })
  })

  // it("should return a 400 status code and error message indicating missing required fields", async () => {
  //   const response = await handler(
  //     generateMockEvent(exampleMissingFields),
  //     {} as any
  //   )
  //   expect(response.statusCode).toBe(400)
  //   expect(JSON.parse(response.body!)).toEqual({
  //     error: "Missing required fields: PrescriptionID, PatientNHSNumber"
  //   })
  // })
})
