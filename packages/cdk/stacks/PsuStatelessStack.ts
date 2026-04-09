import {App, Stack} from "aws-cdk-lib"
import {nagSuppressions} from "../nagSuppressions"
import {StandardStackProps} from "@nhsdigital/eps-cdk-constructs"

export interface PsuStatelessStackProps extends StandardStackProps {
  readonly stackName: string
  readonly logRetentionInDays: number
  readonly mutualTlsTrustStoreKey: string | undefined
  readonly forwardCsocLogs: boolean
  readonly csocApiGatewayDestination: string
  readonly deployCheckPrescriptionStatusUpdate: boolean
  readonly exposeGetStatusUpdates: boolean
}

export class PsuStatelessStack extends Stack {
  public constructor(scope: App, id: string, props: PsuStatelessStackProps) {
    super(scope, id, props)

    // Apis construct will be instantiated here once Functions and StateMachines are migrated:
    //
    // const functions = new Functions(this, "Functions", { ... })
    // const stateMachines = new StateMachines(this, "StateMachines", { ... })
    // new Apis(this, "Apis", {
    //   stackName: props.stackName,
    //   logRetentionInDays: props.logRetentionInDays,
    //   mutualTlsTrustStoreKey: props.mutualTlsTrustStoreKey,
    //   forwardCsocLogs: props.forwardCsocLogs,
    //   csocApiGatewayDestination: props.csocApiGatewayDestination,
    //   deployCheckPrescriptionStatusUpdate: props.deployCheckPrescriptionStatusUpdate,
    //   exposeGetStatusUpdates: props.exposeGetStatusUpdates,
    //   functions: functions.functions,
    //   stateMachines: stateMachines.stateMachines,
    // })

    nagSuppressions(this)
  }
}
