import {filterOutPostDatedUpdates} from "../src/getStatusUpdates"
import {inputPrescriptionType} from "../src/schema/request"
import {outputPrescriptionType, itemType} from "../src/schema/response"

type scenariosType = {
  scenarioDescription: string
  inputPrescriptions: inputPrescriptionType
  queryResults: Array<itemType>
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
        itemId: "item_1",
        latestStatus: "latest_status",
        isTerminalState: true,
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
          isTerminalState: true,
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
        itemId: "item_1",
        latestStatus: "early_status",
        isTerminalState: true,
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "latest_status",
        isTerminalState: true,
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
          isTerminalState: true,
          lastUpdateDateTime: "1971-01-01T00:00:00Z"
        }
      ]
    }
  },
  {
    scenarioDescription: "should return latest item for multiple updates for each of multiple statuses",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        itemId: "item_1",
        latestStatus: "item_1_status",
        isTerminalState: true,
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "latest_item_1_status",
        isTerminalState: true,
        lastUpdateDateTime: "1972-01-01T00:00:00Z"
      },
      {
        itemId: "item_2",
        latestStatus: "item_2_status",
        isTerminalState: true,
        lastUpdateDateTime: "1971-01-01T00:00:00Z"
      },
      {
        itemId: "item_2",
        latestStatus: "early_item_2_status",
        isTerminalState: true,
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
          isTerminalState: true,
          lastUpdateDateTime: "1972-01-01T00:00:00Z"
        },
        {
          itemId: "item_2",
          latestStatus: "item_2_status",
          isTerminalState: true,
          lastUpdateDateTime: "1971-01-01T00:00:00Z"
        }
      ]
    }
  },
  {
    scenarioDescription: "should exclude item when post-dated update hasn't matured",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "2030-01-01T00:00:00Z", // Future, no fallback
        postDatedLastModifiedSetAt:"1972-01-01T00:00:00Z"
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: []
    }
  },
  {
    scenarioDescription: "should use latest post-dated update when multiple have matured",
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        itemId: "item_1",
        latestStatus: "With pharmacy",
        isTerminalState: false,
        lastUpdateDateTime: "1970-01-01T00:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "1971-01-01T00:00:00Z",
        postDatedLastModifiedSetAt: "1970-01-02T00:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "1972-01-01T00:00:00Z",
        postDatedLastModifiedSetAt: "1971-01-02T00:00:00Z"
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "With pharmacy",
          isTerminalState: false,
          lastUpdateDateTime: "1970-01-01T00:00:00Z"
        },
        {
          itemId: "item_1",
          latestStatus: "Ready to collect",
          isTerminalState: false,
          lastUpdateDateTime: "1972-01-01T00:00:00Z",
          postDatedLastModifiedSetAt: "1971-01-02T00:00:00Z"
        }
      ]
    }
  }
]
describe("Unit tests for buildResults", () => {
  it.each<scenariosType>(scenarios)("$scenarioDescription", ({inputPrescriptions, queryResults, expectedResult}) => {
    // Use a fixed time of 2000-01-01 for tests (946684800000 ms since epoch)
    const fixedCurrentTime = new Date("2000-01-01T00:00:00Z").getTime()
    const result = filterOutPostDatedUpdates(inputPrescriptions, queryResults, fixedCurrentTime)
    expect(result).toMatchObject(expectedResult)
  })
})
