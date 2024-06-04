import {deliveryType, itemStatusType} from "../../src/schema/format_1"
import {getBusinessStatus} from "../../src/schema/format_1/transformer"

it("should convert a delivery type business status", () => {
  const itemStatus: itemStatusType = "ReadyForCollection"
  const deliveryType: deliveryType = "Robot Collection"

  const businessStatus = getBusinessStatus(deliveryType, itemStatus)
  expect(businessStatus.value()).toEqual("Ready to Collect")
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
