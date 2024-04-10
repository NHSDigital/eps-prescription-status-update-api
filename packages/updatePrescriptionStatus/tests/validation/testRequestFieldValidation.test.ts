/* eslint-disable @typescript-eslint/no-explicit-any */

import {expect, describe, it} from "@jest/globals"
import {BundleEntry, Task} from "fhir/r4"

import {taskFields, validateFields} from "../../src/validation/fields"

import valid from "../tasks/valid.json"
import {FULL_URL_0} from "../utils/testUtils"

describe("Unit tests for validateFields", () => {
  it("when all fields present, return valid", async () => {
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: valid as Task}
    const result = validateFields(entry)
    expect(result).toEqual({valid: true, issues: undefined})
  })

  it("when fields missing on task, return invalid with message", async () => {
    const invalid: any = {...valid}
    delete invalid.id
    delete invalid.basedOn
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: invalid as Task}

    const result = validateFields(entry)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - PrescriptionID, TaskID."})
  })

  it("when fields missing on entry and task, return invalid with message", async () => {
    const invalid: any = {...valid}
    delete invalid.id
    delete invalid.basedOn
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: invalid as Task}
    delete entry.fullUrl

    const result = validateFields(entry)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - FullUrl, PrescriptionID, TaskID."})
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

    const actual = taskFields(task as Task)

    expect(actual).toEqual([missingField])
  })
})
