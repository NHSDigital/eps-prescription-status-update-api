import {format_1_handler} from "../src/cpsu"
import {format_1} from "../src/schema"
import mockContext from "./mockContext"
import format_1_example_json from "./format_1_example.json"

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

    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(202)
    expect(JSON.parse(response.body)).toEqual("Message Ignored")
  })

  test("Message missing field receives 400 and appropriate message", async () => {
    // Missing ODS
    const body: Partial<format_1.eventType> = format_1_example()
    delete body.oDSCode

    const event = {
      headers: {},
      body: body
    }
    const response = await format_1_handler(event as format_1.eventType, dummyContext)
    expect(response.statusCode).toEqual(400)
    expect(JSON.parse(response.body)).toEqual([{error: "must have required property 'oDSCode'", path: "/body"}])
  })
})
