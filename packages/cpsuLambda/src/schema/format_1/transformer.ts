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
import {Md5} from "ts-md5"

export const transformer: Transformer<requestType> = (requestBody, logger, headers) => {
  const bundle_entry_template = generateTemplate(requestBody)

  return requestBody.items
    .map((item) => populateTemplate(bundle_entry_template, item, requestBody, logger))
    .all_ok()
    .map(bundle_entries)
    .mapErr(wrap_with_status(400, headers))
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
    logger.info(
      `Invalid business status on item ${prescriptionItem.itemID}.` +
        `Unable to map delivery type ${prescriptionDetails.deliveryType} and item status ${prescriptionItem.status}`
    )
    return Err(`Invalid business status on item ${prescriptionItem.itemID}`)
  } else {
    const statusValue = businessStatus.value()
    entry.resource!.businessStatus!.coding![0].code = statusValue

    if (prescriptionDetails.deliveryType === "Robot Collection") {
      if (prescriptionItem.status === "ReadyForCollection") {
        entry.resource!.status = "in-progress"
      } else if (prescriptionItem.status === "DispensingComplete") {
        entry.resource!.status = "completed"
      }
    }
  }

  entry.resource!.status = TASK_STATUS_MAP[prescriptionItem.status]
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

  const uuid = generate_uuid(prescriptionItem, prescriptionDetails)
  entry.resource!.id = uuid
  const urn = `urn:uuid:${uuid}`
  entry.fullUrl = urn

  return Ok(entry)
}

/**
 * Generates a UUID seeded from prescription details and item details.
 */
function generate_uuid(prescriptionItem: itemType, prescriptionDetails: requestType): string {
  const prescriptionDetailsToHash = {
    messageDate: prescriptionDetails.messageDate,
    prescriptionUUID: prescriptionDetails.prescriptionUUID,
    repeatNo: prescriptionDetails.repeatNo,
    oDSCode: prescriptionDetails.oDSCode,
    deliveryType: prescriptionDetails.deliveryType,
    nHSCHI: prescriptionDetails.nHSCHI
  }

  const itemDetailsToHash = {
    itemID: prescriptionItem.itemID,
    status: prescriptionItem.status
  }

  const details = JSON.stringify([prescriptionDetailsToHash, itemDetailsToHash])
  // 16 byte MD5 hash
  const hash = new Md5().appendStr(details).end()

  const seed = hash
    ?.toString()
    .windows(2)
    .map((hex) => parseInt(hex, 16))

  return uuidv4({random: seed})
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
    "Robot Collection": "Ready to Dispatch",
    "Delivery required": "Ready to Dispatch"
  },
  PartOwed: "With Pharmacy - Preparing Remainder",
  DispensingComplete: {
    "In-Store Collection": "Collected",
    "Robot Collection": "Dispatched",
    "Delivery required": "Dispatched"
  }
}

const TASK_STATUS_MAP: Record<itemStatusType, Task["status"]> = {
  Pending: "in-progress",
  ReadyForCollection: "in-progress",
  Owed: "in-progress",
  PartOwed: "in-progress",
  Cancelled: "completed",
  Expired: "completed",
  NotDispensed: "completed",
  DispensingComplete: "completed"
}
