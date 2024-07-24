import {BundleEntry, Task} from "fhir/r4"
import {generateTemplate, getBusinessStatus, populateTemplate} from "../../src/schema/format_1/transformer"
import {
  itemType,
  requestType,
  deliveryType,
  itemStatusType,
  completedStatusType
} from "../../src/schema/format_1"
import {Logger} from "@aws-lambda-powertools/logger"

interface BusinessStatusTestCase {
  itemStatus: itemStatusType
  deliveryType: deliveryType
  expectedStatus: string
}

interface PopulateTemplateTestCase {
  itemStatus: itemStatusType
  deliveryType: deliveryType
  expectItemDefined: boolean
  // Optional fields, which may or may not be present
  expectedBusinessStatus?: string
  expectedTaskStatus?: string
  itemCompletedStatus?: completedStatusType
}

describe("getBusinessStatus function", () => {
  const testCases: Array<BusinessStatusTestCase> = [
    {itemStatus: "ReadyForCollection", deliveryType: "Robot Collection", expectedStatus: "Ready to Dispatch"},
    {itemStatus: "NotDispensed", deliveryType: "Robot Collection", expectedStatus: "Not Dispensed"},
    {itemStatus: "Expired", deliveryType: "Robot Collection", expectedStatus: "Not Dispensed"},
    {itemStatus: "DispensingComplete", deliveryType: "Robot Collection", expectedStatus: "Dispatched"},
    {itemStatus: "ReadyForCollection", deliveryType: "Delivery required", expectedStatus: "Ready to Dispatch"},
    {itemStatus: "DispensingComplete", deliveryType: "Delivery required", expectedStatus: "Dispatched"}
  ]

  testCases.forEach(({itemStatus, deliveryType, expectedStatus}) => {
    it(`should convert itemStatus: ${itemStatus} and deliveryType: ${deliveryType} to ${expectedStatus}`, () => {
      const businessStatus = getBusinessStatus(deliveryType, itemStatus)
      expect(businessStatus).toEqual(expectedStatus)
    })
  })
})

describe("populateTemplate function", () => {
  const testCases: Array<PopulateTemplateTestCase> = [
    {
      itemStatus: "ReadyForCollection",
      deliveryType: "Robot Collection",
      expectedBusinessStatus: "Ready to Dispatch",
      expectedTaskStatus: "in-progress",
      expectItemDefined: true
    },
    {
      itemStatus: "DispensingComplete",
      deliveryType: "Robot Collection",
      expectedBusinessStatus: "Dispatched",
      expectedTaskStatus: "completed",
      expectItemDefined: true
    },
    {
      itemStatus: "DispensingComplete",
      itemCompletedStatus: "Cancelled",
      deliveryType: "Not known",
      expectItemDefined: false
    },
    {
      itemStatus: "DispensingComplete",
      itemCompletedStatus: "Expired",
      deliveryType: "Not known",
      expectItemDefined: false
    },
    {
      itemStatus: "DispensingComplete",
      itemCompletedStatus: "NotDispensed",
      deliveryType: "Not known",
      expectItemDefined: false
    },
    {
      itemStatus: "DispensingComplete",
      itemCompletedStatus: "Collected",
      deliveryType: "Robot Collection",
      expectedBusinessStatus: "Dispatched",
      expectedTaskStatus: "completed",
      expectItemDefined: true
    }
  ]

  testCases.forEach(
    ({
      itemStatus,
      deliveryType,
      expectedBusinessStatus,
      expectedTaskStatus,
      expectItemDefined,
      itemCompletedStatus
    }) => {
      it(`should populate template for itemStatus: ${itemStatus} and completedStatus: ${itemCompletedStatus}`, () => {
        const template: string = generateTemplate({
          MessageType: "ExampleMessageType",
          items: [{itemID: "item1", status: itemStatus, completedStatus: itemCompletedStatus}],
          prescriptionUUID: "123456789",
          nHSCHI: "123456",
          messageDate: new Date().toISOString(),
          oDSCode: "XYZ",
          deliveryType: deliveryType,
          repeatNo: 1
        })

        const prescriptionItem: itemType = {
          itemID: "item1",
          status: itemStatus,
          completedStatus: itemCompletedStatus
        }

        const prescriptionDetails: requestType = {
          MessageType: "ExampleMessageType",
          items: [{itemID: "item1", status: itemStatus, completedStatus: itemCompletedStatus}],
          prescriptionUUID: "123456789",
          nHSCHI: "123456",
          messageDate: new Date().toISOString(),
          oDSCode: "XYZ",
          deliveryType: deliveryType,
          repeatNo: 1
        }

        const logger = new Logger()
        const result = populateTemplate(template, prescriptionItem, prescriptionDetails, logger)

        const entry: BundleEntry<Task> = result.value() as BundleEntry<Task>

        if (expectItemDefined) {
          // Check that the template is correctly populated
          expect(entry.resource!.businessStatus!.coding![0].code).toEqual(expectedBusinessStatus)
          expect(entry.resource!.status).toEqual(expectedTaskStatus)
        } else {
          // If expectItemDefined is false, we expect Nothing
          expect(result.isNothing()).toBeTruthy()
        }
      })
    }
  )
})
