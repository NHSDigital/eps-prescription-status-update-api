import {assert} from "console"
import {buildResults} from "../src/getStatusUpdates"
import {inputPrescriptionType} from "../src/schema/request"
import {DynamoDBResult} from "../src/schema/result"
import {outputPrescriptionType} from "../src/schema/response"

describe("Unit tests for build results", () => {
  it("should return correct data when a matched prescription found", () => {
    const inputPrescriptions: Array<inputPrescriptionType> = [{
      prescriptionID: "abc",
      odsCode: "123"
    }]

    const queryResults: Array<DynamoDBResult> = [{
      prescriptionID: "abc",
      itemId: "item_1",
      latestStatus: "latest_status",
      isTerminalState: "is_terminal_status",
      lastUpdateDateTime: "1970-01-01T00:00:00Z"
    }]

    const result = buildResults(inputPrescriptions, queryResults)

    const expectedResult: Array<outputPrescriptionType> = [
      {
        prescriptionID: "abc",
        onboarded: true,
        items: [{
          itemId: "item_1",
          latestStatus: "latest_status",
          isTerminalState: "is_terminal_status",
          lastUpdateDateTime: "1970-01-01T00:00:00Z"
        }]
      }
    ]

    assert(result === expectedResult)
  })
})
