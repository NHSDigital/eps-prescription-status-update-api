import {PSUDataItem, PostDatedNotifyDataItem} from "packages/common/commonTypes/lib/src"

export function createMockDataItem(overrides: Partial<PSUDataItem>): PSUDataItem {
  return {
    LastModified: "2023-01-02T00:00:00Z",
    LineItemID: "spamandeggs",
    PatientNHSNumber: "0123456789",
    PharmacyODSCode: "ABC123",
    PrescriptionID: "abcdef-ghijkl-mnopqr",
    RequestID: "x-request-id",
    Status: "ready to collect",
    TaskID: "mnopqr-ghijkl-abcdef",
    TerminalStatus: "ready to collect",
    ApplicationName: "Internal Test System",
    ExpiryTime: 123,
    ...overrides
  }
}

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
