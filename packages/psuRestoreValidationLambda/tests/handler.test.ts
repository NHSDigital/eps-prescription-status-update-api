import {EventBridgeEvent} from "aws-lambda"
import {
  jest,
  expect,
  describe,
  it
} from "@jest/globals"
import {backupEventCompletedDetail} from "../src/types"
import {Backup} from "@aws-sdk/client-backup"

import {mockContext} from "@PrescriptionStatusUpdate_common/testing"

const mockCompareTables = jest.fn()
jest.unstable_mockModule("../src/compareTable", () => {
  return {
    compareTables: mockCompareTables
  }
})

const {handler} = await import("../src/handler")

const dummyEvent: EventBridgeEvent<"Restore Job State Change", backupEventCompletedDetail> = {
  "version":"0",
  "id":"dummy_id",
  "detail-type":"Restore Job State Change",
  "source":"aws.backup",
  "account":"dummy_account",
  "time":"2025-06-05T07:01:35Z",
  "region":"eu-west-2",
  "resources":[
    "arn:dummy_recovery_point_arn"
  ], "detail":{
    "restoreJobId":"dummy_restore_job_id",
    "backupSizeInBytes":"1880",
    "creationDate":"2025-06-05T06:52:16.637Z",
    "iamRoleArn":"arn:dummy_backup_role_arn",
    "percentDone":100,
    "resourceType":"DynamoDB.FullyManaged",
    "status":"COMPLETED",
    "createdResourceArn":"arn:dummy_created_resource_arn",
    "completionDate":"2025-06-05T06:58:27.692Z",
    "restoreTestingPlanArn":"arn:dummy_restore_testing_plan_arn",
    "backupVaultArn":"arn:dummy_backup_vault_arn",
    "recoveryPointArn":"arn:dummy_recovery_point_arn",
    "sourceResourceArn":"arn:dummy_source_resource_arn"
  }
}

describe("Unit test for psuRestoreValidationLambda", function () {
  let mockPutRestoreValidationResult: unknown
  beforeAll(()=> {
    mockPutRestoreValidationResult = jest
      .spyOn( Backup.prototype, "putRestoreValidationResult")
      .mockResolvedValue("success" as never)

  })
  it("sends a success message when validate is successful", async () => {
    mockCompareTables.mockImplementation(() => true)

    await handler(
      dummyEvent,
      mockContext
    )

    expect(mockPutRestoreValidationResult).toHaveBeenCalledWith(
      {
        "RestoreJobId": "dummy_restore_job_id",
        "ValidationStatus": "SUCCESSFUL",
        "ValidationStatusMessage": "Resource validation succeeded"
      }
    )
  })

  it("sends a failure message when validate is not successful", async () => {
    mockCompareTables.mockImplementation(() => false)

    await handler(
      dummyEvent,
      mockContext
    )

    expect(mockPutRestoreValidationResult).toHaveBeenCalledWith(
      {
        "RestoreJobId": "dummy_restore_job_id",
        "ValidationStatus": "FAILED",
        "ValidationStatusMessage": "Resource validation succeeded"
      }
    )
  })

})
