import {BundleEntry, Task} from "fhir/r4"
import {Logger} from "@aws-lambda-powertools/logger"
import {getBusinessStatus, populateTemplate} from "../../src/schema/format_1/transformer"
import {
  itemType,
  requestType,
  deliveryType,
  itemStatusType
} from "../../src/schema/format_1"

function testBusinessStatusConversion(itemStatus: itemStatusType, deliveryType: deliveryType, expectedStatus: string) {
  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual(expectedStatus)
}

describe("getBusinessStatus function", () => {
  it("should convert a delivery type business status", () => {
    testBusinessStatusConversion("ReadyForCollection", "Robot Collection", "Ready to Dispatch")
  })

  it("should convert an item status business status", () => {
    testBusinessStatusConversion("NotDispensed", "Robot Collection", "Not Dispensed")
  })

  it("should return Nothing if the item status is not in the map", () => {
    const itemStatus: itemStatusType = "Expired"
    const deliveryType: deliveryType = "Robot Collection"

    const businessStatus = getBusinessStatus(deliveryType, itemStatus)
    expect(businessStatus.isNothing()).toBeTruthy()
  })

  it("should convert a DispensingComplete status with Robot Collection", () => {
    testBusinessStatusConversion("DispensingComplete", "Robot Collection", "Dispatched")
  })

  it("should handle ReadyForCollection status with Robot Collection correctly", () => {
    testBusinessStatusConversion("ReadyForCollection", "Robot Collection", "Ready to Dispatch")
  })

  it("should convert a delivery type business status for Delivery required", () => {
    testBusinessStatusConversion("ReadyForCollection", "Delivery required", "Ready to Dispatch")
  })

  it("should convert an item status business status for Delivery required", () => {
    testBusinessStatusConversion("DispensingComplete", "Delivery required", "Dispatched")
  })
})

describe("populateTemplate function", () => {
  let mockLogger: Logger

  beforeEach(() => {
    mockLogger = new Logger()
  })

  function runTestCase(
    itemStatus: itemStatusType,
    deliveryType: deliveryType,
    expectedBusinessStatus: string,
    expectedTaskStatus: string
  ) {
    const template: string = generateTemplate({
      items: [{itemID: "item1", status: itemStatus}],
      prescriptionUUID: "123456789",
      nHSCHI: "123456",
      messageDate: new Date().toISOString(),
      oDSCode: "XYZ",
      deliveryType: deliveryType,
      repeatNo: 1
    })

    const prescriptionItem: itemType = {
      itemID: "item1",
      status: itemStatus
    }

    const prescriptionDetails: requestType = {
      items: [{itemID: "item1", status: itemStatus}],
      prescriptionUUID: "123456789",
      nHSCHI: "123456",
      messageDate: new Date().toISOString(),
      oDSCode: "XYZ",
      deliveryType: deliveryType,
      repeatNo: 1
    }

    const result = populateTemplate(template, prescriptionItem, prescriptionDetails, mockLogger)

    if (result.isOk()) {
      const entry: BundleEntry<Task> = result.value()
      expect(entry.resource!.businessStatus!.coding![0].code).toEqual(expectedBusinessStatus)
      expect(entry.resource!.status).toEqual(expectedTaskStatus)
    }
  }

  it("should populate template correctly for Robot Collection with ReadyForCollection status", () => {
    runTestCase("ReadyForCollection", "Robot Collection", "Ready to Dispatch", "in-progress")
  })

  it("should populate template correctly for Robot Collection with DispensingComplete status", () => {
    runTestCase("DispensingComplete", "Robot Collection", "Dispatched", "completed")
  })
})
