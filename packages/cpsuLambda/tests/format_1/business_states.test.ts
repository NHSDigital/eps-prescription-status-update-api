import {deliveryType, itemStatusType} from "../../src/schema/format_1"
import {getBusinessStatus} from "../../src/schema/format_1/transformer"

function testBusinessStatusConversion(itemStatus: itemStatusType, deliveryType: deliveryType, expectedStatus: string) {
  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual(expectedStatus)
}

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
