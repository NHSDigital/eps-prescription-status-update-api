import {CfnOutput, RemovalPolicy, Stack} from "aws-cdk-lib"
import {ManagedPolicy, PolicyStatement} from "aws-cdk-lib/aws-iam"
import {StringParameter} from "aws-cdk-lib/aws-ssm"
import {Construct} from "constructs"

export interface ParametersProps {
  readonly stackName: string
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

export class Parameters extends Construct {
  public constructor(scope: Construct, id: string, props: ParametersProps) {
    super(scope, id)

    const {region, account} = Stack.of(this)

    const enabledSiteOdsCodes = new StringParameter(this, "EnabledSiteODSCodesParameter", {
      parameterName: `${props.stackName}-PSUNotifyEnabledSiteODSCodes`,
      description: "List of site ODS codes for which notifications are enabled",
      stringValue: props.enabledSiteOdsCodes
    })
    enabledSiteOdsCodes.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const enabledSystems = new StringParameter(this, "EnabledSystemsParameter", {
      parameterName: `${props.stackName}-PSUNotifyEnabledSystems`,
      description: "List of application names for which notifications are enabled",
      stringValue: props.enabledSystems
    })
    enabledSystems.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const enabledSupplierApplicationIds = new StringParameter(
      this, "EnabledSupplierApplicationIDsParameter", {
        parameterName: `${props.stackName}-PSUNotifyEnabledSupplierApplicationIDs`,
        description: "List of supplier application IDs for which notifications are enabled",
        stringValue: props.enabledSupplierApplicationIds
      })
    enabledSupplierApplicationIds.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const blockedSiteOdsCodes = new StringParameter(this, "BlockedSiteODSCodesParameter", {
      parameterName: `${props.stackName}-PSUNotifyBlockedSiteODSCodes`,
      description: "List of site ODS codes for which notifications are blocked",
      stringValue: props.blockedSiteOdsCodes
    })
    blockedSiteOdsCodes.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const notifyRoutingPlanId = new StringParameter(this, "NotifyRoutingPlanIDParameter", {
      parameterName: `${props.stackName}-PSUNotifyRoutingPlanID`,
      description: "Notify Routing Plan ID",
      stringValue: props.notifyRoutingPlanId
    })
    notifyRoutingPlanId.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const notifyApiBaseUrl = new StringParameter(this, "NotifyAPIBaseURLParameter", {
      parameterName: `${props.stackName}-PSUNotifyApiBaseUrl`,
      description: "Notify API Base URL",
      stringValue: props.notifyApiBaseUrl
    })
    notifyApiBaseUrl.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const enableNotificationsExternal = new StringParameter(this, "EnableNotificationsExternal", {
      parameterName: `${props.stackName}-EnableNotificationsExternal`,
      description: "Toggle on or off if we make real requests to the NHS notify service",
      stringValue: props.enableNotificationsExternal
    })
    enableNotificationsExternal.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const enableNotificationsInternal = new StringParameter(this, "EnableNotificationsInternal", {
      parameterName: `${props.stackName}-EnableNotificationsInternal`,
      description: "Toggle the notifications integration entirely",
      stringValue: props.enableNotificationsInternal
    })
    enableNotificationsInternal.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const testPrescriptions1 = new StringParameter(this, "TestPrescriptionsParameter1", {
      parameterName: `${props.stackName}-TEST_PRESCRIPTIONS_1`,
      description: "Test prescriptions parameter 1",
      stringValue: props.testPrescriptions1
    })
    testPrescriptions1.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const testPrescriptions2 = new StringParameter(this, "TestPrescriptionsParameter2", {
      parameterName: `${props.stackName}-TEST_PRESCRIPTIONS_2`,
      description: "Test prescriptions parameter 2",
      stringValue: props.testPrescriptions2
    })
    testPrescriptions2.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const testPrescriptions3 = new StringParameter(this, "TestPrescriptionsParameter3", {
      parameterName: `${props.stackName}-TEST_PRESCRIPTIONS_3`,
      description: "Test prescriptions parameter 3",
      stringValue: props.testPrescriptions3
    })
    testPrescriptions3.applyRemovalPolicy(RemovalPolicy.DESTROY)

    const testPrescriptions4 = new StringParameter(this, "TestPrescriptionsParameter4", {
      parameterName: `${props.stackName}-TEST_PRESCRIPTIONS_4`,
      description: "Test prescriptions parameter 4",
      stringValue: props.testPrescriptions4
    })
    testPrescriptions4.applyRemovalPolicy(RemovalPolicy.DESTROY)

    // IAM policy granting ssm:GetParameter on all 12 parameters above
    const getNotificationsParameterPolicy = new ManagedPolicy(
      this, "GetNotificationsParameterPolicy", {
        description: "Allows reading SSM parameters",
        statements: [
          new PolicyStatement({
            actions: ["ssm:GetParameter", "ssm:GetParameters"],
            resources: [
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyEnabledSiteODSCodes`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyEnabledSystems`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyEnabledSupplierApplicationIDs`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyBlockedSiteODSCodes`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyRoutingPlanID`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-PSUNotifyApiBaseUrl`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-EnableNotificationsExternal`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-EnableNotificationsInternal`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-TEST_PRESCRIPTIONS_1`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-TEST_PRESCRIPTIONS_2`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-TEST_PRESCRIPTIONS_3`,
              `arn:aws:ssm:${region}:${account}:parameter/${props.stackName}-TEST_PRESCRIPTIONS_4`
            ]
          })
        ]
      })

    // Exports — names must match exactly what Functions.ts imports via Fn.importValue
    new CfnOutput(this, "GetNotificationsParameterPolicyOutput", {
      value: getNotificationsParameterPolicy.managedPolicyArn,
      exportName: `${props.stackName}-GetNotificationsParameterPolicy`
    })
    new CfnOutput(this, "EnabledSiteODSCodesParameterNameOutput", {
      value: enabledSiteOdsCodes.parameterName,
      exportName: `${props.stackName}-PSUNotifyEnabledSiteODSCodesParam`
    })
    new CfnOutput(this, "EnabledSystemsParameterNameOutput", {
      value: enabledSystems.parameterName,
      exportName: `${props.stackName}-PSUNotifyEnabledSystemsParam`
    })
    new CfnOutput(this, "EnabledSupplierApplicationIDsParameterNameOutput", {
      value: enabledSupplierApplicationIds.parameterName,
      exportName: `${props.stackName}-PSUNotifyEnabledSupplierApplicationIDsParam`
    })
    new CfnOutput(this, "BlockedSiteODSCodesParameterNameOutput", {
      value: blockedSiteOdsCodes.parameterName,
      exportName: `${props.stackName}-PSUNotifyBlockedSiteODSCodesParam`
    })
    new CfnOutput(this, "NotifyRoutingPlanIDParameterNameOutput", {
      value: notifyRoutingPlanId.parameterName,
      exportName: `${props.stackName}-PSUNotifyRoutingPlanIDParam`
    })
    new CfnOutput(this, "NotifyAPIBaseURLParameterNameOutput", {
      value: notifyApiBaseUrl.parameterName,
      exportName: `${props.stackName}-PSUNotifyApiBaseUrlParam`
    })
    new CfnOutput(this, "EnableNotificationsExternalNameOutput", {
      value: enableNotificationsExternal.parameterName,
      exportName: `${props.stackName}-EnableNotificationsExternalName`
    })
    new CfnOutput(this, "EnableNotificationsInternalNameOutput", {
      value: enableNotificationsInternal.parameterName,
      exportName: `${props.stackName}-EnableNotificationsInternalName`
    })
    new CfnOutput(this, "TestPrescriptionsParameterName1Output", {
      value: testPrescriptions1.parameterName,
      exportName: `${props.stackName}-TestPrescriptionsParameterName1`
    })
    new CfnOutput(this, "TestPrescriptionsParameterName2Output", {
      value: testPrescriptions2.parameterName,
      exportName: `${props.stackName}-TestPrescriptionsParameterName2`
    })
    new CfnOutput(this, "TestPrescriptionsParameterName3Output", {
      value: testPrescriptions3.parameterName,
      exportName: `${props.stackName}-TestPrescriptionsParameterName3`
    })
    new CfnOutput(this, "TestPrescriptionsParameterName4Output", {
      value: testPrescriptions4.parameterName,
      exportName: `${props.stackName}-TestPrescriptionsParameterName4`
    })
  }
}
