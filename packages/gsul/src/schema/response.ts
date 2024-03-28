import {FromSchema} from "json-schema-to-ts"

const itemSchema = {
  type: "object",
  required: ["itemId", "latestStatus", "isTerminalState", "lastUpdateDateTime"],
  properties: {
    itemId: {
      type: "string"
    },
    latestStatus: {
      type: "string"
    },
    isTerminalState: {
      type: "string"
    },
    lastUpdateDateTime: {
      type: "string"
    }
  }
} as const

const outputPrescriptionSchema = {
  type: "object",
  properties: {
    prescriptionID: {
      type: "string"
    },
    onboarded: {
      type: "boolean"
    },
    items: {
      type: "array",
      items: itemSchema
    }
  }
} as const

const responseSchema = {
  type: "object",
  required: ["schemaVersion", "isSuccess", "prescriptions"],
  properties: {
    schemaVersion: {
      type: "number"
    },
    isSuccess: {
      type: "boolean"
    },
    prescriptions: {
      type: "array",
      items: outputPrescriptionSchema
    }
  }
} as const

type responseType = FromSchema<typeof responseSchema>
type outputPrescriptionType = FromSchema<typeof outputPrescriptionSchema>
type itemType = FromSchema<typeof itemSchema>
export {responseSchema, responseType, outputPrescriptionSchema, outputPrescriptionType, itemSchema, itemType}
