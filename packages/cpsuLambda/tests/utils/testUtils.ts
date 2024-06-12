/* eslint-disable @typescript-eslint/no-explicit-any */

import {jest} from "@jest/globals"

// Uses unstable jest method to enable mocking while using ESM. To be replaced in future.
export function mockUuid() {
  const mockV4 = jest.fn()
  jest.unstable_mockModule("uuid", () => {
    return {
      v4: mockV4
    }
  })
  return {mockV4}
}
