import {
  jest,
  describe,
  it,
  expect,
  beforeEach
} from "@jest/globals"
import {APIGatewayProxyResult} from "aws-lambda"

import {buildHandler} from "../src/notificationsReportingLambda"
import type {NotificationsRepository} from "../src/notificationsRepository"
import {mockAPIGatewayProxyEvent} from "@psu-common/testing"

const buildEvent = (query: Record<string, string | undefined>) => ({
  ...mockAPIGatewayProxyEvent,
  httpMethod: "GET",
  queryStringParameters: query
})

describe("notificationsReportingLambda", () => {
  let fetchMock: jest.MockedFunction<NotificationsRepository["fetch"]>
  let repo: NotificationsRepository

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<NotificationsRepository["fetch"]>
    repo = {fetch: fetchMock} as unknown as NotificationsRepository
  })

  it("returns 400 when no filters are provided", async () => {
    const handler = buildHandler(() => repo)
    const result: APIGatewayProxyResult = await handler(buildEvent({}))

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toEqual({
      message: "Provide at least one of prescriptionId, nhsNumber or odsCode"
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("delegates to the repository and returns matches", async () => {
    fetchMock.mockResolvedValue([
      {
        RequestId: "req-1",
        NHSNumber: "123",
        ODSCode: "A1B",
        LastNotifiedPrescriptionStatus: "DELIVERED",
        LastNotificationRequestTimestamp: new Date().toISOString(),
        ExpiryTime: 123,
        NotifyMessageReference: "ref-1"
      }
    ])

    const handler = buildHandler(() => repo)
    const result: APIGatewayProxyResult = await handler(
      buildEvent({nhsNumber: " 123 ", odsCode: "ab1"})
    )

    expect(fetchMock).toHaveBeenCalledWith({nhsNumber: "123", odsCode: "AB1"})
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject({
      count: 1,
      filters: {
        nhsNumberProvided: true,
        odsCode: "AB1"
      }
    })
  })

  it("handles repository errors", async () => {
    fetchMock.mockRejectedValue(new Error("boom"))
    const handler = buildHandler(() => repo)

    const result = await handler(buildEvent({prescriptionId: "rx-1"}))

    expect(result.statusCode).toBe(500)
    expect(JSON.parse(result.body)).toEqual({message: "Failed to fetch notification statuses"})
  })
})
