import {FORMAT_1_PARAMS, format_1_handler} from "../src/cpsu"
import {format_1} from "../src/schema"
import mockContext from "./mockContext"
import format_1_example_json from "./format_1_example.json"
import {newHandler} from "../src/handler"
import {MIDDLEWARE} from "../src/middleware"
import {Logger} from "@aws-lambda-powertools/logger"
import {jest} from "@jest/globals"

const format_1_example = () => {
  return JSON.parse(JSON.stringify(format_1_example_json))
}

const dummyContext = mockContext

describe("format_1 handler", () => {
  test("Happy path", async () => {
    const event = {
      headers: {},
      body: format_1_example()
    }

    const expectedResponse = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          fullUrl: "urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46",
          resource: {
            resourceType: "Task",
            id: "4d70678c-81e4-4ff4-8c67-17596fd0aa46",
            input: [
              {
                type: {text: "Repeat Number"},
                valueInteger: 3
              }
            ],
            basedOn: [
              {
                identifier: {
                  system: "https://fhir.nhs.uk/Id/prescription-order-number",
                  value: "490795-B83002-00001S"
                }
              }
            ],
            // status: "in-progress",
            businessStatus: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt",
                  code: "With Pharmacy"
                }
              ]
            },
            intent: "order",
            focus: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/prescription-order-item-number",
                value: "73014c50-1bd1-4359-9c9f-d587d7d03e66"
              }
            },
            for: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/nhs-number",
                value: "1996344668"
              }
            },
            lastModified: "2023-09-11T10:11:12Z",
            owner: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/ods-organization-code",
                value: "FHA82"
              }
            }
          },
          request: {
            method: "POST",
            url: "Task"
          }
        },
        {
          fullUrl: "urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46",
          resource: {
            resourceType: "Task",
            id: "4d70678c-81e4-4ff4-8c67-17596fd0aa46",
            input: [
              {
                type: {text: "Repeat Number"},
                valueInteger: 3
              }
            ],
            basedOn: [
              {
                identifier: {
                  system: "https://fhir.nhs.uk/Id/prescription-order-number",
                  value: "490795-B83002-00001S"
                }
              }
            ],
            // status: "in-progress",
            businessStatus: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt",
                  code: "With Pharmacy"
                }
              ]
            },
            intent: "order",
            focus: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/prescription-order-item-number",
                value: "73014c50-1bd1-4361-9c9f-d587d7d03e66"
              }
            },
            for: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/nhs-number",
                value: "1996344668"
              }
            },
            lastModified: "2023-09-11T10:11:12Z",
            owner: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/ods-organization-code",
                value: "FHA82"
              }
            }
          },
          request: {
            method: "POST",
            url: "Task"
          }
        }
      ]
    }

    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    const responseBody = JSON.parse(response.body)

    expect(response.statusCode).toEqual(200)
    responseBody.entry[0].fullUrl = expectedResponse.entry[0].fullUrl
    responseBody.entry[0].resource.id = expectedResponse.entry[0].resource.id
    responseBody.entry[0].resource.lastModified = expectedResponse.entry[0].resource.lastModified

    responseBody.entry[1].fullUrl = expectedResponse.entry[1].fullUrl
    responseBody.entry[1].resource.id = expectedResponse.entry[1].resource.id
    responseBody.entry[1].resource.lastModified = expectedResponse.entry[1].resource.lastModified

    expect(responseBody).toEqual(expectedResponse)
  })

  test("Messages that are not of type 'PrescriptionStatusChanged' are ignored", async () => {
    const body = format_1_example()
    body.MessageType = "NOTPrescriptionStatusChanged"

    const event = {
      headers: {},
      body
    }

    const mockLogger = {info: jest.fn()}
    const handler = newHandler({
      params: FORMAT_1_PARAMS,
      middleware: [MIDDLEWARE.validator, MIDDLEWARE.validationErrorHandler],
      logger: mockLogger as unknown as Logger,
      schema: format_1.eventSchema
    })

    const response = await handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(202)
    expect(JSON.parse(response.body)).toEqual("Message Ignored")
    expect(mockLogger["info"]).toHaveBeenCalledWith("Message Ignored")
  })

  test("Message missing field receives 400 and appropriate message", async () => {
    const body = format_1_example()
    delete body.oDSCode

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([{error: "must have required property 'oDSCode'", path: "/body"}])
  })

  test("Message missing fields receives 400 and appropriate message", async () => {
    const body = format_1_example()
    delete body.oDSCode
    delete body.items[0].itemID

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([
      {error: "must have required property 'oDSCode'", path: "/body"},
      {error: "must have required property 'itemID'", path: "/body/items/0"}
    ])
  })

  test("Message with incorrect field type receives 400 and appropriate message", async () => {
    const body = format_1_example()
    body.repeatNo = "not a number"

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([{error: "must be number", path: "/body/repeatNo"}])
  })

  test("Requests with no repeatNo are accepted", async () => {
    const body = format_1_example()
    delete body.repeatNo

    const event = {
      headers: {},
      body: body
    }

    const expectedResponse = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          fullUrl: "urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46",
          resource: {
            resourceType: "Task",
            id: "4d70678c-81e4-4ff4-8c67-17596fd0aa46",
            basedOn: [
              {
                identifier: {
                  system: "https://fhir.nhs.uk/Id/prescription-order-number",
                  value: "490795-B83002-00001S"
                }
              }
            ],
            // status: "in-progress",
            businessStatus: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt",
                  code: "With Pharmacy"
                }
              ]
            },
            intent: "order",
            focus: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/prescription-order-item-number",
                value: "73014c50-1bd1-4359-9c9f-d587d7d03e66"
              }
            },
            for: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/nhs-number",
                value: "1996344668"
              }
            },
            lastModified: "2023-09-11T10:11:12Z",
            owner: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/ods-organization-code",
                value: "FHA82"
              }
            }
          },
          request: {
            method: "POST",
            url: "Task"
          }
        },
        {
          fullUrl: "urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46",
          resource: {
            resourceType: "Task",
            id: "4d70678c-81e4-4ff4-8c67-17596fd0aa46",
            basedOn: [
              {
                identifier: {
                  system: "https://fhir.nhs.uk/Id/prescription-order-number",
                  value: "490795-B83002-00001S"
                }
              }
            ],
            // status: "in-progress",
            businessStatus: {
              coding: [
                {
                  system: "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt",
                  code: "With Pharmacy"
                }
              ]
            },
            intent: "order",
            focus: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/prescription-order-item-number",
                value: "73014c50-1bd1-4361-9c9f-d587d7d03e66"
              }
            },
            for: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/nhs-number",
                value: "1996344668"
              }
            },
            lastModified: "2023-09-11T10:11:12Z",
            owner: {
              identifier: {
                system: "https://fhir.nhs.uk/Id/ods-organization-code",
                value: "FHA82"
              }
            }
          },
          request: {
            method: "POST",
            url: "Task"
          }
        }
      ]
    }

    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(200)
    const responseBody = JSON.parse(response.body)

    responseBody.entry[0].fullUrl = expectedResponse.entry[0].fullUrl
    responseBody.entry[0].resource.id = expectedResponse.entry[0].resource.id
    responseBody.entry[0].resource.lastModified = expectedResponse.entry[0].resource.lastModified

    responseBody.entry[1].fullUrl = expectedResponse.entry[1].fullUrl
    responseBody.entry[1].resource.id = expectedResponse.entry[1].resource.id
    responseBody.entry[1].resource.lastModified = expectedResponse.entry[1].resource.lastModified

    expect(responseBody).toEqual(expectedResponse)
  })

  test("Request with invalid business state returns 400", async () => {
    const body = format_1_example()
    body.items[0].status = "Expired"
    body.deliveryType = "Robot Collection"

    const event = {
      headers: {},
      body: body
    }

    const mockLogger = {info: jest.fn()}
    const handler = newHandler({
      params: FORMAT_1_PARAMS,
      middleware: [MIDDLEWARE.validator, MIDDLEWARE.validationErrorHandler],
      logger: mockLogger as unknown as Logger,
      schema: format_1.eventSchema
    })

    const response = await handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([`Invalid business status on item ${body.items[0].itemID}`])
    expect(mockLogger["info"]).toHaveBeenCalledWith(
      `Invalid business status on item ${body.items[0].itemID}.` +
        `Unable to map delivery type ${body.deliveryType} and item status ${body.items[0].status}`
    )
  })
})
