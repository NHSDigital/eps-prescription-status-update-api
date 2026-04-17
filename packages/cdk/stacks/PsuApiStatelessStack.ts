import {App, Stack} from "aws-cdk-lib"
import {nagSuppressions} from "../nagSuppressions"
import {StandardStackProps} from "@nhsdigital/eps-cdk-constructs"
import {Functions} from "../resources/Functions"
import {StateMachines} from "../resources/StateMachines"
import {Apis} from "../resources/Apis"

export interface PsuApiStatelessStackProps extends StandardStackProps {
  readonly stackName: string
  readonly samStackName: string
  readonly logRetentionInDays: number
  readonly logLevel: string
  readonly environment: string
  readonly mutualTlsTrustStoreKey: string | undefined
  readonly forwardCsocLogs: boolean
  readonly csocApiGatewayDestination: string
  readonly deployCheckPrescriptionStatusUpdate: boolean
  readonly exposeGetStatusUpdates: boolean
  readonly enablePostDatedNotifications: string
  readonly requireApplicationName: string
  readonly enableBackup: boolean
}

export class PsuApiStatelessStack extends Stack {
  public constructor(scope: App, id: string, props: PsuApiStatelessStackProps) {
    super(scope, id, props)

    const functions = new Functions(this, "Functions", {
      stackName: props.stackName,
      samStackName: props.samStackName,
      version: props.version,
      commitId: props.commitId,
      logRetentionInDays: props.logRetentionInDays,
      logLevel: props.logLevel,
      environment: props.environment,
      enablePostDatedNotifications: props.enablePostDatedNotifications,
      requireApplicationName: props.requireApplicationName,
      deployCheckPrescriptionStatusUpdate: props.deployCheckPrescriptionStatusUpdate,
      enableBackup: props.enableBackup
    })

    const stateMachines = new StateMachines(this, "StateMachines", {
      stackName: props.stackName,
      logRetentionInDays: props.logRetentionInDays,
      functions: functions.functions
    })

    new Apis(this, "Apis", {
      stackName: props.stackName,
      logRetentionInDays: props.logRetentionInDays,
      mutualTlsTrustStoreKey: props.mutualTlsTrustStoreKey,
      forwardCsocLogs: props.forwardCsocLogs,
      csocApiGatewayDestination: props.csocApiGatewayDestination,
      deployCheckPrescriptionStatusUpdate: props.deployCheckPrescriptionStatusUpdate,
      exposeGetStatusUpdates: props.exposeGetStatusUpdates,
      functions: functions.functions,
      stateMachines: stateMachines.stateMachines
    })

    nagSuppressions(this)
  }
}
