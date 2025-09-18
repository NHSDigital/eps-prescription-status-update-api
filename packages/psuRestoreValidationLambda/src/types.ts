export interface backupEventCompletedDetail {
  restoreJobId: string
  backupSizeInBytes: string
  creationDate: string
  iamRoleArn: string
  percentDone: number
  resourceType: string
  status: string
  createdResourceArn: string
  completionDate :string
  restoreTestingPlanArn: string
  backupVaultArn: string
  recoveryPointArn: string
  sourceResourceArn: string
}
