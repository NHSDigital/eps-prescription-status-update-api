import {App, Stack} from "aws-cdk-lib"
import {StandardStackProps} from "@nhsdigital/eps-cdk-constructs"
import {Parameters} from "../resources/Parameters"
import {Tables} from "../resources/Tables"
import {Secrets} from "../resources/Secrets"
import {Messaging} from "../resources/Messaging"

export interface PsuApiStatefulStackProps extends StandardStackProps {
  readonly stackName: string
  readonly logRetentionInDays: number
  readonly environment: string
  readonly enableDynamoDBAutoScaling: boolean
  readonly enableBackup: boolean
  // SSM Parameter values — deployed as configuration alongside infrastructure
  readonly enabledSiteOdsCodes: string
  readonly enabledSystems: string
  readonly enabledSupplierApplicationIds: string
  readonly blockedSiteOdsCodes: string
  readonly notifyRoutingPlanId: string
  readonly notifyApiBaseUrl: string
  readonly enableNotificationsExternal: string
  readonly enableNotificationsInternal: string
  readonly testPrescriptions1: string
  readonly testPrescriptions2: string
  readonly testPrescriptions3: string
  readonly testPrescriptions4: string
}

export class PsuApiStatefulStack extends Stack {
  public constructor(scope: App, id: string, props: PsuApiStatefulStackProps) {
    super(scope, id, props)

    new Parameters(this, "Parameters", {
      stackName: props.stackName,
      enabledSiteOdsCodes: props.enabledSiteOdsCodes,
      enabledSystems: props.enabledSystems,
      enabledSupplierApplicationIds: props.enabledSupplierApplicationIds,
      blockedSiteOdsCodes: props.blockedSiteOdsCodes,
      notifyRoutingPlanId: props.notifyRoutingPlanId,
      notifyApiBaseUrl: props.notifyApiBaseUrl,
      enableNotificationsExternal: props.enableNotificationsExternal,
      enableNotificationsInternal: props.enableNotificationsInternal,
      testPrescriptions1: props.testPrescriptions1,
      testPrescriptions2: props.testPrescriptions2,
      testPrescriptions3: props.testPrescriptions3,
      testPrescriptions4: props.testPrescriptions4
    })

    new Tables(this, "Tables", {
      stackName: props.stackName,
      enableDynamoDBAutoScaling: props.enableDynamoDBAutoScaling,
      enableBackup: props.enableBackup
    })

    new Secrets(this, "Secrets", {
      stackName: props.stackName
    })

    new Messaging(this, "Messaging", {
      stackName: props.stackName
    })
  }
}
