/* eslint-disable @typescript-eslint/no-explicit-any */

import {expect, describe, it} from "@jest/globals"
import {Task} from "fhir/r4"

import {fields, validateFields} from "../../src/validation/fields"

import valid from "../tasks/valid.json"

describe("Unit tests for validateFields", () => {
  it("when all fields present, return valid", async () => {
    const result = validateFields(valid as Task)
    expect(result).toEqual({valid: true, issues: undefined})
  })

  it("when fields missing, return invalid with message", async () => {
    const invalid: any = {...valid}
    delete invalid.id
    delete invalid.basedOn

    const result = validateFields(invalid)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - PrescriptionID, TaskID."})
  })
})

describe("Unit tests for validation of individual fields", () => {
  it.each([
    {
      missingField: "LastModified",
      operation: ((t: Task) => delete t.lastModified)
    },
    {
      missingField: "LineItemID",
      operation: ((t: Task) => delete t.focus)
    },
    {
      missingField: "PatientNHSNumber",
      operation: ((t: Task) => delete t.for)
    },
    {
      missingField: "PharmacyODSCode",
      operation: ((t: Task) => delete t.owner)
    },
    {
      missingField: "PrescriptionID",
      operation: ((t: Task) => delete t.basedOn)
    },
    {
      missingField: "Status",
      operation: ((t: Task) => delete t.businessStatus)
    },
    {
      missingField: "TaskID",
      operation: ((t: Task) => delete t.id)
    }
  ])("When $missingField is missing, should return expected issue.", async ({operation, missingField}) => {
    const task = {...valid} as any
    operation(task)

    const expected = `Missing required field(s) - ${missingField}.`

    const actual = fields(task as Task)

    expect(actual).toEqual(expected)
  })
})
