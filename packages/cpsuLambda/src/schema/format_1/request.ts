import {FromSchema, JSONSchema} from "json-schema-to-ts"

const itemStatusSchema = {
  type: "string",
  enum: [
    "Pending",
    "Owed",
    "ReadyForCollection",
    "PartOwed",
    "Cancelled",
    "Expired",
    "NotDispensed",
    "DispensingComplete"
  ]
} as const satisfies JSONSchema

const completedStatusSchema = {
  type: "string",
  enum: ["Cancelled", "Expired", "NotDispensed", "Collected"]
} as const satisfies JSONSchema

const itemSchema = {
  type: "object",
  required: ["itemID", "status"],
  properties: {
    itemID: {
      type: "string"
    },
    status: itemStatusSchema,
    completedStatus: completedStatusSchema
  }
} as const satisfies JSONSchema

const prescriptionStatusSchema = {
  type: "string",
  enum: ["PatientMatched", "DispensingStarted", "Reset", "Returned", "DispensingComplete"]
} as const satisfies JSONSchema

const deliveryTypeSchema = {
  type: "string",
  enum: ["Not known", "In-Store Collection", "Robot Collection", "Delivery required"]
} as const satisfies JSONSchema

const requestSchema = {
  type: "object",
  required: ["MessageType", "messageDate", "prescriptionUUID", "oDSCode", "deliveryType", "nHSCHI", "items"],
  properties: {
    MessageType: {
      type: "string"
    },
    messageDate: {
      type: "string"
    },
    prescriptionUUID: {
      type: "string"
    },
    repeatNo: {
      type: "number"
    },
    oDSCode: {
      type: "string"
    },
    deliveryType: deliveryTypeSchema,
    nHSCHI: {
      type: "string"
    },
    items: {
      type: "array",
      items: itemSchema
    }
  }
} as const satisfies JSONSchema

const eventSchema = {
  type: "object",
  required: ["body", "headers"],
  properties: {
    body: requestSchema,
    headers: {
      type: "object"
    }
  }
} as const satisfies JSONSchema

type eventType = FromSchema<typeof eventSchema>
type requestType = FromSchema<typeof requestSchema>
type deliveryType = FromSchema<typeof deliveryTypeSchema>
type prescriptionStatusType = FromSchema<typeof prescriptionStatusSchema>
type itemType = FromSchema<typeof itemSchema>
type itemStatusType = FromSchema<typeof itemStatusSchema>
export {
  eventSchema,
  eventType,
  requestSchema,
  requestType,
  deliveryTypeSchema,
  deliveryType,
  prescriptionStatusSchema,
  prescriptionStatusType,
  itemSchema,
  itemType,
  itemStatusSchema,
  itemStatusType
}
