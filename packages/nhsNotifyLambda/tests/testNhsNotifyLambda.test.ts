import {describe, it} from "@jest/globals"

import axios from "axios"
import MockAdapter from "axios-mock-adapter"

import {handler} from "../src/nhsNotifyLambda"
import {mockContext, mockEventBridgeEvent} from "@PrescriptionStatusUpdate_common/testing"

const mock = new MockAdapter(axios)

describe("Unit test for NHS Notify lambda handler", function () {
  let originalEnv: {[key: string]: string | undefined} = process.env
  afterEach(() => {
    process.env = {...originalEnv}
    mock.reset()
  })

  it("Dummy test", async () => {
    console.error("DUMMY TEST - PASSING ANYWAY")

    await handler(mockEventBridgeEvent, mockContext)
  })
})
