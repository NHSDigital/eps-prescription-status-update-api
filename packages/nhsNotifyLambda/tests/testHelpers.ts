import {DataItem} from "../src/types"

export function constructDataItem(overrides: Partial<DataItem> = {}) {
  return {
    LastModified: "2023-01-01T00:00:00Z",
    LineItemID: "LineItemID_1",
    PatientNHSNumber: "PatientNHSNumber_1",
    PharmacyODSCode: "PharmacyODSCode_1",
    PrescriptionID: "PrescriptionID_1",
    RequestID: "RequestID_1",
    Status: "Status_1",
    TaskID: "TaskID_1",
    TerminalStatus: "TerminalStatus_1",
    ApplicationName: "appname",
    ExpiryTime: 10,
    ...overrides
  }
}
