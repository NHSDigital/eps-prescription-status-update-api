import {FromSchema, JSONSchema} from "json-schema-to-ts"

export const taskSchema = {
  "type": "object",
  "required": [
    "id",
    "resourceType",
    "basedOn",
    "status",
    "businessStatus",
    "intent",
    "focus",
    "for",
    "lastModified",
    "owner"
  ],
  "properties": {
    "resourceType": {
      "type": "string",
      "enum": [
        "Task"
      ]
    },
    "id": {
      "type": "string",
      "description": "The unique identifier for the Task resource.",
      "examples": ["4d70678c-81e4-4ff4-8c67-17596fd0aa46"]
    },
    "basedOn": {
      "type": "array",
      "description": "Short-form Prescription ID for the parent prescription. Should only contain one item.",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "object",
        "required": [
          "identifier"
        ],
        "properties": {
          "identifier": {
            "type": "object",
            "required": [
              "system",
              "value"
            ],
            "properties": {
              "system": {
                "type": "string",
                "enum": [
                  "https://fhir.nhs.uk/Id/prescription-order-number"
                ]
              },
              "value": {
                "type": "string",
                "examples": ["24F5DA-A83008-7EFE6Z"]
              }
            }
          }
        }
      }
    },
    "status": {
      "type": "string",
      "description": "Indicator to identify when the prescription id status is a terminal status, " +
        "one for which no further patient action is required. If the prescription item status is a terminal status, " +
        "the Task.status value must be set to 'completed', otherwise the value must be set to 'in-progress'.",
      "enum": [
        "in-progress",
        "completed"
      ]
    },
    "businessStatus": {
      "type": "object",
      "description": "The tracking status for the prescription id. Updates should only be provided when the " +
        "prescription id is 'ready to collect' in which case the status value will be 'ready to collect', " +
        "or when the patient has received the prescription item and there are no more actions for the patient, " +
        "in this case the status value could be 'Collected' or 'Dispatched'. The dispensing system may update " +
        "the prescription item status with any of the following values to correct a status update which has been " +
        "made in error or where the status has since reverted: 'With Pharmacy', 'Ready to collect', 'Collected' or " +
        "'Dispatched'. Note: The 'With Pharmacy' status can be determined using the EPS record status for business " +
        "as usual processing and is not required from the dispensing system unless the status needs to be rolled back.",
      "required": [
        "coding"
      ],
      "properties": {
        "coding": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "items": {
            "type": "object",
            "required": [
              "system",
              "code"
            ],
            "properties": {
              "system": {
                "type": "string",
                "enum": [
                  "https://fhir.nhs.uk/CodeSystem/task-businessStatus-nppt"
                ]
              },
              "code": {
                "type": "string",
                "enum": [
                  "With Pharmacy",
                  "With Pharmacy - Preparing Remainder",
                  "Ready to Collect",
                  "Ready to Collect - Partial",
                  "Collected",
                  "Dispatched",
                  "Not Dispensed",
                  "Ready to Dispatch",
                  "Ready to Dispatch - Partial"
                ]
              }
            }
          }
        }
      }
    },
    "intent": {
      "type": "string",
      "description": "Order is the allowed value to indicate the update informs an actionable task.",
      "enum": [
        "order"
      ]
    },
    "focus": {
      "type": "object",
      "description": "Identifier for the prescription line item represented by the task resource.",
      "required": [
        "identifier"
      ],
      "properties": {
        "identifier": {
          "type": "object",
          "required": [
            "system",
            "value"
          ],
          "properties": {
            "system": {
              "type": "string",
              "enum": [
                "https://fhir.nhs.uk/Id/prescription-order-item-number"
              ]
            },
            "value": {
              "type": "string",
              "examples": ["6989b7bd-8db6-428c-a593-4022e3044c00"]
            }
          }
        }
      }
    },
    "for": {
      "type": "object",
      "description": "The patient's NHS number. The primary identifier of a patient, unique within " +
        "NHS England and Wales. Always 10 digits and must be a valid NHS number.",
      "required": [
        "identifier"
      ],
      "properties": {
        "identifier": {
          "type": "object",
          "required": [
            "system",
            "value"
          ],
          "properties": {
            "system": {
              "type": "string",
              "enum": [
                "https://fhir.nhs.uk/Id/nhs-number"
              ]
            },
            "value": {
              "type": "string",
              "examples": ["9449304130"]
            }
          }
        }
      }
    },
    "lastModified": {
      "type": "string",
      "description": "Date and time, specified as UTC value, when the prescription item status was updated. " +
        "Only the latest last modified date will be displayed to users of the NHS App. " +
        "This mechanism will be implemented to resolve updates received out of sequence.",
      "format": "date-time",
      "examples": ["2024-01-30T12:01:24.000Z"]
    },
    "owner": {
      "type": "object",
      "description": "ODS organisation code for the pharmacy that is processing the prescription.",
      "required": [
        "identifier"
      ],
      "properties": {
        "identifier": {
          "type": "object",
          "required": [
            "system",
            "value"
          ],
          "properties": {
            "system": {
              "type": "string",
              "enum": [
                "https://fhir.nhs.uk/Id/ods-organization-code"
              ]
            },
            "value": {
              "type": "string",
              "examples": ["C9Z1O"]
            }
          }
        }
      }
    },
    "input": {
      "type": "array",
      "description": "The eRD Repeat Number, with the prescription tracking status updates for eRD prescriptions. " +
        "This is optional and only required for eRD type prescriptions.",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "object",
        "required": [
          "type",
          "valueInteger"
        ],
        "properties": {
          "type": {
            "type": "object",
            "required": [
              "text"
            ],
            "properties": {
              "text": {
                "type": "string",
                "enum": [
                  "Repeat Number"
                ]
              }
            }
          },
          "valueInteger": {
            "type": "integer",
            "minimum": 1
          }
        }
      }
    }
  }
} as const satisfies JSONSchema

export const bundleEntrySchema = {
  "type": "object",
  "required": [
    "fullUrl",
    "resource",
    "request"
  ],
  "description": "A FHIR collection Bundle.",
  "properties": {
    "fullUrl": {
      "type": "string",
      "examples": ["urn:uuid:4d70678c-81e4-4ff4-8c67-17596fd0aa46"]
    },
    "resource": taskSchema,
    "request": {
      "type": "object",
      "required": [
        "method",
        "url"
      ],
      "properties": {
        "method": {
          "type": "string",
          "enum": [
            "POST"
          ]
        },
        "url": {
          "type": "string",
          "enum": [
            "Task"
          ]
        }
      }
    }
  }
} as const satisfies JSONSchema

export const bundleSchema = {
  "type": "object",
  "required": [
    "entry",
    "resourceType",
    "type"
  ],
  "description": "A FHIR transaction Bundle.",
  "properties": {
    "resourceType": {
      "type": "string",
      "description": "FHIR resource type.",
      "enum": [
        "Bundle"
      ]
    },
    "type": {
      "type": "string",
      "description": "Denotes that the bundle is a list of status updates to be performed as one transaction.",
      "enum": [
        "transaction"
      ]
    },
    "entry": {
      "type": "array",
      "description": "A collection of resources contained within the Bundle.\n",
      "items": bundleEntrySchema
    }
  }
} as const satisfies JSONSchema

export const eventSchema = {
  type: "object",
  required: ["body", "headers"],
  properties: {
    body: bundleSchema,
    headers: {
      type: "object"
    }
  }
} as const satisfies JSONSchema

export type taskType = FromSchema<typeof taskSchema>
export type bundleEntryType = FromSchema<typeof bundleEntrySchema>
export type bundleType = FromSchema<typeof bundleSchema>
