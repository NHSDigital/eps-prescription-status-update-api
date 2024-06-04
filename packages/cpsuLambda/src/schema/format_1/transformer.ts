import {Bundle, BundleEntry, Task} from "fhir/r4"
import {
  itemStatusType,
  itemType,
  requestType,
  deliveryType
} from "./request"
import {
  Err,
  Just,
  Maybe,
  Ok,
  Result,
  get
} from "pratica"
import {v4 as uuidv4} from "uuid"
import {Transformer} from "../../handler"
import {Logger} from "@aws-lambda-powertools/logger"
import {wrap_with_status} from "../../utils"

export const transformer: Transformer<requestType> = (requestBody, logger) => {
  const bundle_entry_template = generateTemplate(requestBody)

  return requestBody.items
    .map((item) => populateTemplate(bundle_entry_template, item, requestBody, logger))
    .collect()
    .map(bundle_entries)
    .mapErr(wrap_with_status(400))
}

function bundle_entries(entries: Array<BundleEntry<Task>>): Bundle<Task> {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries
  }
}

function generateTemplate(requestBody: requestType): string {
  return JSON.stringify({
    resource: {
      resourceType: "Task",
      basedOn: [
        {
          identifier: {
            system: "https://fhir.nhs.uk/Id/prescription-order-number",
            value: requestBody.prescriptionUUID
          }
        }
      ],
      businessStatus: {
        coding: [
          {
            system: "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt"
          }
        ]
      },
      intent: "order",
      focus: {
        identifier: {
          system: "https://fhir.nhs.uk/Id/prescription-order-item-number"
        }
      },
      for: {
        identifier: {
          system: "https://fhir.nhs.uk/Id/nhs-number",
          value: requestBody.nHSCHI
        }
      },
      lastModified: requestBody.messageDate,
      owner: {
        identifier: {
          system: "https://fhir.nhs.uk/Id/ods-organization-code",
          value: requestBody.oDSCode
        }
      }
    },
    request: {
      method: "POST",
      url: "Task"
    }
  })
}

function populateTemplate(
  template: string,
  prescriptionItem: itemType,
  prescriptionDetails: requestType,
  logger: Logger
): Result<BundleEntry<Task>, string> {
  const entry = JSON.parse(template) as BundleEntry<Task>

  const businessStatus = getBusinessStatus(prescriptionDetails.deliveryType, prescriptionItem.status)
  if (businessStatus.isNothing()) {
    logger.error(
      `Invalid business status on item ${prescriptionItem.itemID}.` +
        `Unable to map prescription status ${prescriptionItem.status} and item status ${prescriptionItem.status}`
    )
    return Err("Invalid business status on item {prescriptionItem.itemID}")
  } else {
    entry.resource!.businessStatus!.coding![0].code = businessStatus.value()
  }

  entry.resource!.focus!.identifier!.value = prescriptionItem.itemID
  entry.resource!.lastModified = prescriptionDetails.messageDate

  if (prescriptionDetails.repeatNo) {
    entry.resource!.input = [
      {
        type: {text: "Repeat Number"},
        valueInteger: prescriptionDetails.repeatNo
      }
    ]
  }

  const uuid = uuidv4()
  entry.resource!.id = uuid
  const urn = `urn:uuid:${uuid}`
  entry.fullUrl = urn

  return Ok(entry)
}

export function getBusinessStatus(deliveryType: deliveryType, itemStatus: itemStatusType): Maybe<string> {
  return get([itemStatus])(BUSINESS_STATUS_MAP).chain((status) => {
    if (typeof status === "string") {
      return Just(status)
    }
    return get([deliveryType])(status) as Maybe<string>
  })
}

type DeliveryTypeMap = Partial<Record<deliveryType, string>>
type ItemStatusMap = Partial<Record<itemStatusType, string | DeliveryTypeMap>>
const BUSINESS_STATUS_MAP: ItemStatusMap = {
  Pending: "With Pharmacy",
  NotDispensed: "Not Dispensed",
  ReadyForCollection: {
    "In-Store Collection": "Ready to Collect",
    "Robot Collection": "Ready to Collect",
    "Delivery required": "Ready to Dispatch"
  },
  PartOwed: "With Pharmacy - Preparing Remainder",
  DispensingComplete: {
    "In-Store Collection": "Collected",
    "Robot Collection": "Collected",
    "Delivery required": "Dispatched"
  }
}
