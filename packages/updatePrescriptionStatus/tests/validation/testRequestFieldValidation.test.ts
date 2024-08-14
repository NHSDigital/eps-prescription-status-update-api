
import {expect, describe, it} from "@jest/globals"
import {BundleEntry, Task} from "fhir/r4"

import {taskFields, validateFields} from "../../src/validation/fields"

import {FULL_URL_0, validTask} from "../utils/testUtils"

describe("Unit tests for validateFields", () => {
  it("when all fields present, return valid", async () => {
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: validTask()}
    const result = validateFields(entry)
    expect(result).toEqual({valid: true, issues: undefined})
  })

  it("when fields missing on task, return invalid with message", async () => {
    const task = validTask()
    delete task.id
    delete task.basedOn
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: task}

    const result = validateFields(entry)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - PrescriptionID, TaskID."})
  })

  it("when fields missing on entry and task, return invalid with message", async () => {
    const task = validTask()
    delete task.id
    delete task.basedOn
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: task}
    delete entry.fullUrl

    const result = validateFields(entry)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - FullUrl, PrescriptionID, TaskID."})
  })

  it("when fields missing on entry, return invalid with message", async () => {
    const task = validTask()
    const entry: BundleEntry = {fullUrl: FULL_URL_0, resource: task}
    delete entry.resource

    const result = validateFields(entry)
    expect(result).toEqual({valid: false, issues: "Missing required field(s) - Resource."})
  })
})

describe("Unit tests for validation of individual fields", () => {
  it.each([
    {
      missingField: "LastModified",
      operation: (t: Task) => delete t.lastModified
    },
    {
      missingField: "LineItemID",
      operation: (t: Task) => delete t.focus
    },
    {
      missingField: "PatientNHSNumber",
      operation: (t: Task) => delete t.for
    },
    {
      missingField: "PharmacyODSCode",
      operation: (t: Task) => delete t.owner
    },
    {
      missingField: "PrescriptionID",
      operation: (t: Task) => delete t.basedOn
    },
    {
      missingField: "Status",
      operation: (t: Task) => delete t.businessStatus
    },
    {
      missingField: "TaskID",
      operation: (t: Task) => delete t.id
    },
    {
      missingField: "PrescriptionID",
      operation: (t: Task) => (t.basedOn = [])
    },
    {
      missingField: "Status",
      operation: (t: Task) => (t.businessStatus = {coding: []})
    }
  ])("When $missingField is missing, should return expected issue.", async ({operation, missingField}) => {
    const task = validTask()
    operation(task)

    const actual = taskFields(task)

    expect(actual).toEqual([missingField])
  })
})
