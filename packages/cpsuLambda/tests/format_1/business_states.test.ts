import {deliveryType, itemStatusType} from "../../src/schema/format_1"
import {getBusinessStatus} from "../../src/schema/format_1/transformer"

it("should convert a delivery type business status", () => {
  const itemStatus: itemStatusType = "ReadyForCollection"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Ready to Dispatch")
})

it("should convert an item status business status", () => {
  const itemStatus: itemStatusType = "NotDispensed"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Not Dispensed")
})

it("should return Nothing if the item status is not in the map", () => {
  const itemStatus: itemStatusType = "Expired"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.isNothing()).toBeTruthy()
})

it("should convert a DispensingComplete status with Robot Collection", () => {
  const itemStatus: itemStatusType = "DispensingComplete"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Dispatched")
})

it("should handle ReadyForCollection status with Robot Collection correctly", () => {
  const itemStatus: itemStatusType = "ReadyForCollection"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Ready to Dispatch")
})

it("should convert a delivery type business status for Delivery required", () => {
  const itemStatus: itemStatusType = "ReadyForCollection"
  const deliveryType: deliveryType = "Delivery required"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Ready to Dispatch")
})

it("should convert an item status business status for Delivery required", () => {
  const itemStatus: itemStatusType = "DispensingComplete"
  const deliveryType: deliveryType = "Delivery required"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Dispatched")
})
