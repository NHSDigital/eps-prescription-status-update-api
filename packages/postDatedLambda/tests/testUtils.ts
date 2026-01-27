import {NotifyDataItem} from "packages/common/commonTypes/lib/src"

export function createMockPostModifiedDataItem(overrides: Partial<NotifyDataItem>): NotifyDataItem {
  return {
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "mnopqr-ghijkl-abcdef",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    ...overrides
  }
}
