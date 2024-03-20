/* eslint-disable @typescript-eslint/no-explicit-any */
import validTask from "../../specification/examples/contentValidation/validTask.json"
import {expect, describe, it} from "@jest/globals"
import {
  ValidationOutcome,
  ONE_DAY_IN_MS,
  lastModified,
  validateTask
} from "../src/requestContentValidation"
import {Task} from "fhir/r4"

describe("Unit tests for overall task validation", () => {
  it.each([
    {
      task: validTask,
      expectedOutcome: {valid: true, issues: []},
      scenarioDescription: "Valid task"
    }
  ])(
    "should return $scenarioDescription",
    async ({task, expectedOutcome}) => {
      const actual: ValidationOutcome = validateTask(task as Task)
      expect(actual).toEqual(expectedOutcome)
    })
})

describe("Unit tests for validation of lastModified", () => {
  it("over a day in the future", async () => {
    const today = new Date()
    const future = new Date(today.valueOf() + ONE_DAY_IN_MS + 1000)
    const task = {...validTask}
    task.lastModified = future.toISOString()

    const expected = "Date provided for lastModified is more than one day in the future."

    const actual = lastModified(task as Task)
    expect(actual).toEqual(expected)
  })

  it("invalid date format", async () => {
    const task = {...validTask}
    task.lastModified = "invalid date"

    const expected = "Date format provided for lastModified is invalid."

    const actual = lastModified(task as Task)
    expect(actual).toEqual(expected)
  })
})
