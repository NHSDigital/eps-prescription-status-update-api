import {PostDatedNotifyDataItem} from "packages/common/commonTypes/lib/src"

export function createMockPostModifiedDataItem(overrides: Partial<PostDatedNotifyDataItem>): PostDatedNotifyDataItem {
  return {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "mnopqr-ghijkl-abcdef",
    PostDatedLastModifiedSetAt: "Changed dosage instructions",
    ...overrides
  }
}
