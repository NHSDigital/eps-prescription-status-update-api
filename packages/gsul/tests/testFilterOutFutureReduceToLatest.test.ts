import {filterOutFutureReduceToLatestUpdates} from "../src/getStatusUpdates"
import {inputPrescriptionType} from "../src/schema/request"
import {outputPrescriptionType, itemType} from "../src/schema/response"

type scenariosType = {
  scenarioDescription: string
  inputPrescriptions: inputPrescriptionType
  queryResults: Array<itemType>
  expectedResult: outputPrescriptionType
  currentTime: number
}
const now = new Date()
const futureDateTime = new Date(now.valueOf() + (24 * 60 * 60 * 1000)).toISOString()
const scenarios: Array<scenariosType> = [
  {
    scenarioDescription: "should return correct data when a matched prescription found",
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
        latestStatus: "item_1_status",
        isTerminalState: true,
        lastUpdateDateTime: "1972-01-01T00:00:00Z" // newer update for item_1
      },
      {
        itemId: "item_2",
        latestStatus: "item_2_status",
        isTerminalState: true,
        lastUpdateDateTime: "1971-01-01T00:00:00Z"
      },
      {
        itemId: "item_2",
        latestStatus: "item_2_status",
        isTerminalState: true,
        lastUpdateDateTime: "1970-01-01T00:00:00Z" // older update for item_2
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "item_1_status",
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
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
        lastUpdateDateTime: "1970-01-02T00:00:00Z",
        postDatedLastModifiedSetAt: "1970-01-01T00:00:00Z" // first RTC: post-dated and matured
      },
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: futureDateTime,
        postDatedLastModifiedSetAt: "1970-01-02T00:00:00Z" // second RTC: post-dated and yet to mature
      },
      {
        itemId: "item_1",
        latestStatus: "With pharmacy",
        isTerminalState: false,
        lastUpdateDateTime: "1970-01-03T00:00:00Z" // Back to 'With pharmacy'
      },
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "1970-01-04T00:00:00Z",
        postDatedLastModifiedSetAt: "1970-01-03T00:00:00Z" // third RTC: post-dated and matured
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
          lastUpdateDateTime: "1970-01-03T00:00:00Z"
        },
        {
          itemId: "item_1",
          latestStatus: "Ready to collect",
          isTerminalState: false,
          lastUpdateDateTime: "1970-01-04T00:00:00Z",
          postDatedLastModifiedSetAt: "1970-01-03T00:00:00Z"
        }
      ]
    }
  },
  {
    scenarioDescription: "should return an item when it _has_ matured even though the post-dated time is in the future",
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "1970-01-01T00:00:00Z",
        postDatedLastModifiedSetAt: futureDateTime
      }
    ],
    expectedResult: {
      prescriptionID: "abc",
      onboarded: true,
      items: [
        {
          itemId: "item_1",
          latestStatus: "Ready to collect",
          isTerminalState: false,
          lastUpdateDateTime: "1970-01-01T00:00:00Z",
          postDatedLastModifiedSetAt: futureDateTime
        }
      ]
    }
  },
  {
    scenarioDescription: "should return no items when empty item status are found",
    currentTime: new Date("2000-01-01T00:00:00Z").getTime(),
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
    scenarioDescription: "should return With pharmacy when RTC has been revoked",
    currentTime: new Date("2025-12-11T12:00:00Z").getTime(),
    inputPrescriptions: {
      prescriptionID: "abc",
      odsCode: "123"
    },
    queryResults: [
      {
        itemId: "item_1",
        latestStatus: "Ready to collect",
        isTerminalState: false,
        lastUpdateDateTime: "2025-12-11T10:00:00Z",
        postDatedLastModifiedSetAt: "2025-12-10T10:00:00Z"
      },
      {
        itemId: "item_1",
        latestStatus: "With pharmacy",
        isTerminalState: false,
        lastUpdateDateTime: "2025-12-10T11:00:00Z"
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
          lastUpdateDateTime: "2025-12-10T11:00:00Z"
        }
      ]
    }
  }
]
describe("Unit tests for buildResults", () => {
  it.each<scenariosType>(scenarios)("$scenarioDescription",
    ({inputPrescriptions, queryResults, expectedResult, currentTime}) => {
      const result = filterOutFutureReduceToLatestUpdates(inputPrescriptions, queryResults, currentTime)
      expect(result).toMatchObject(expectedResult)
    })
})
