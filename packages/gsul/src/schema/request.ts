import {FromSchema} from "json-schema-to-ts"

const inputPrescriptionSchema = {
  type: "object",
  required: ["prescriptionID", "odsCode"],
  properties: {
    prescriptionID: {
      type: "string"
    },
    odsCode: {
      type: "string"
    }
  }
} as const

const requestSchema = {
  type: "object",
  required: ["schemaVersion", "prescriptions"],
  properties: {
    schemaVersion: {
      type: "number"
    },
    prescriptions: {
      type: "array",
      items: inputPrescriptionSchema
    }
  }
} as const

type requestType = FromSchema<typeof requestSchema>
type inputPrescriptionType = FromSchema<typeof inputPrescriptionSchema>
export {requestSchema, requestType, inputPrescriptionSchema, inputPrescriptionType}
