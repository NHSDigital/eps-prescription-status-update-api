import {BundleEntry, Task} from "fhir/r4"
import {Logger} from "@aws-lambda-powertools/logger"
import {generateTemplate, getBusinessStatus, populateTemplate} from "../../src/schema/format_1/transformer"
import {
  itemType,
  requestType,
  deliveryType,
  itemStatusType
} from "../../src/schema/format_1"

interface BusinessStatusTestCase {
  itemStatus: itemStatusType
  deliveryType: deliveryType
  expectedStatus: string | null
}

interface PopulateTemplateTestCase {
  itemStatus: itemStatusType
  deliveryType: deliveryType
  expectedBusinessStatus: string
  expectedTaskStatus: string
}

describe("getBusinessStatus function", () => {
  const testCases: Array<BusinessStatusTestCase> = [
    {itemStatus: "ReadyForCollection", deliveryType: "Robot Collection", expectedStatus: "Ready to Dispatch"},
    {itemStatus: "NotDispensed", deliveryType: "Robot Collection", expectedStatus: "Not Dispensed"},
    {itemStatus: "Expired", deliveryType: "Robot Collection", expectedStatus: null},
    {itemStatus: "DispensingComplete", deliveryType: "Robot Collection", expectedStatus: "Dispatched"},
    {itemStatus: "ReadyForCollection", deliveryType: "Delivery required", expectedStatus: "Ready to Dispatch"},
    {itemStatus: "DispensingComplete", deliveryType: "Delivery required", expectedStatus: "Dispatched"}
  ]

  testCases.forEach(({itemStatus, deliveryType, expectedStatus}) => {
    it(`should convert itemStatus: ${itemStatus} and deliveryType: ${deliveryType} to ${expectedStatus}`, () => {
      const businessStatus = getBusinessStatus(deliveryType, itemStatus)
      if (expectedStatus) {
        expect(businessStatus.value()).toEqual(expectedStatus)
      } else {
        expect(businessStatus.isNothing()).toBeTruthy()
      }
    })
  })
})

describe("populateTemplate function", () => {
  let mockLogger: Logger

  beforeEach(() => {
    mockLogger = new Logger()
  })

  const testCases: Array<PopulateTemplateTestCase> = [
    {
      itemStatus: "ReadyForCollection",
      deliveryType: "Robot Collection",
      expectedBusinessStatus: "Ready to Dispatch",
      expectedTaskStatus: "in-progress"
    },
    {
      itemStatus: "DispensingComplete",
      deliveryType: "Robot Collection",
      expectedBusinessStatus: "Dispatched",
      expectedTaskStatus: "completed"
    }
  ]

  testCases.forEach(({itemStatus, deliveryType, expectedBusinessStatus, expectedTaskStatus}) => {
    it(`should populate template correctly for itemStatus: ${itemStatus} and deliveryType: ${deliveryType}`, () => {
      const template: string = generateTemplate({
        MessageType: "ExampleMessageType",
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
        MessageType: "ExampleMessageType",
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
        const entry: BundleEntry<Task> = result.value() as BundleEntry<Task>
        expect(entry.resource!.businessStatus!.coding![0].code).toEqual(expectedBusinessStatus)
        expect(entry.resource!.status).toEqual(expectedTaskStatus)
      }
    })
  })
})
