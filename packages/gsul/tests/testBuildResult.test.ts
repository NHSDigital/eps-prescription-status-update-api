import {buildResult} from "../src/getStatusUpdates"
import {inputPrescriptionType} from "../src/schema/request"
import {DynamoDBResult} from "../src/schema/result"
import {outputPrescriptionType} from "../src/schema/response"

type scenariosType = {
  scenarioDescription: string
  inputPrescriptions: inputPrescriptionType
  queryResults: Array<DynamoDBResult>
  expectedResult: outputPrescriptionType
}
const scenarios: Array<scenariosType> = [
  {
    scenarioDescription: "should return correct data when a matched prescription found",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        prescriptionID: "abc",
        itemId: "item_1",
        latestStatus: "latest_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "latest_status",
          isTerminalState: "is_terminal_status",
          lastUpdateDateTime: "1970-01-01T00:00:00Z"
        }
      ]
    }
  },
  {
    scenarioDescription: "should return no items when empty item status are found",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: false,
      items: []
    }
  },
  {
    scenarioDescription: "should return latest data when a multiple updates found",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        prescriptionID: "abc",
        itemId: "item_1",
        latestStatus: "early_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        prescriptionID: "abc",
        itemId: "item_1",
        latestStatus: "latest_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1971-01-01T00:00:00Z"
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "latest_status",
          isTerminalState: "is_terminal_status",
          lastUpdateDateTime: "1971-01-01T00:00:00Z"
        }
      ]
    }
  },
  {
    scenarioDescription: "should return correct data for multiple items",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        prescriptionID: "abc",
        itemId: "item_1",
        latestStatus: "item_1_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        prescriptionID: "abc",
        itemId: "item_1",
        latestStatus: "latest_item_1_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1972-01-01T00:00:00Z"
      },
      {
        prescriptionID: "abc",
        itemId: "item_2",
        latestStatus: "item_2_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1971-01-01T00:00:00Z"
      },
      {
        prescriptionID: "abc",
        itemId: "item_2",
        latestStatus: "early_item_2_status",
        isTerminalState: "is_terminal_status",
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "latest_item_1_status",
          isTerminalState: "is_terminal_status",
          lastUpdateDateTime: "1972-01-01T00:00:00Z"
        },
        {
          itemId: "item_2",
          latestStatus: "item_2_status",
          isTerminalState: "is_terminal_status",
          lastUpdateDateTime: "1971-01-01T00:00:00Z"
        }
      ]
    }
  }
]
describe("Unit tests for buildResults", () => {
  it.each<scenariosType>(scenarios)("$scenarioDescription", ({inputPrescriptions, queryResults, expectedResult}) => {
    const result = buildResult(inputPrescriptions, queryResults)
    expect(result).toMatchObject(expectedResult)
  })
})
