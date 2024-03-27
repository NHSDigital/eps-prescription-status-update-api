/* eslint-disable @typescript-eslint/no-explicit-any */

import {expect, describe, it} from "@jest/globals"
import {Task} from "fhir/r4"

import valid from "./tasks/valid.json"
import {fields} from "../src/validation/fields"

describe("Unit tests for validation of fields", () => {
  it.each([
    {
      missingField: "PatientNHSNumber",
      operation: ((t: Task) => delete t.for)
    },
    {
      missingField: "TaskID",
      operation: ((t: Task) => delete t.id)
    },
    {
      missingField: "PrescriptionID",
      operation: ((t: Task) => delete t.basedOn)
    }
  ])("When $missingField is missing, should return expected issue.", async ({operation, missingField}) => {
    const task = {...valid} as any
    operation(task)

    const expected = `Missing required fields - ${missingField}.`

    const actual = fields(task as Task)

    expect(actual).toEqual(expected)
  })
})
