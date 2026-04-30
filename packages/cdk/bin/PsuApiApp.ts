import {
  calculateVersionedStackName,
  createApp,
  getBooleanConfigFromEnvVar,
  getConfigFromEnvVar,
  getNumberConfigFromEnvVar
} from "@nhsdigital/eps-cdk-constructs"
import {PsuApiStatelessStack} from "../stacks/PsuApiStatelessStack"
import {PsuApiStatefulStack} from "../stacks/PsuApiStatefulStack"

type StackMode = "stateless" | "stateful"

function mergeStackModeIntoStackName(baseStackName: string, stackMode: StackMode): string {
  return `${baseStackName}-${stackMode}`
}

function getStackMode(): StackMode {
  const stackMode = getConfigFromEnvVar("stackMode", undefined, "stateless")

  if (stackMode === "stateless" || stackMode === "stateful") {
    return stackMode
  }

  throw new Error(`Invalid CDK_CONFIG_stackMode: ${stackMode}. Expected 'stateless' or 'stateful'.`)
}

async function main() {
  const {app, props} = createApp({
    productName: "Prescription Status Update API",
    appName: "PsuApiApp",
    repoName: "eps-prescription-status-update-api",
    driftDetectionGroup: "psu-api"
  })

  const stackMode = getStackMode()
  const baseStackName = getConfigFromEnvVar("stackName")
  const modeAwareStackName = mergeStackModeIntoStackName(baseStackName, stackMode)

  if (stackMode === "stateless") {
    new PsuApiStatelessStack(app, "PsuApiStatelessStack", {
      ...props,
      stackName: calculateVersionedStackName(modeAwareStackName, props),
      samStackName: getConfigFromEnvVar("samStackName"), // TODO: REMOVE THE NEED FOR THIS
      logRetentionInDays: getNumberConfigFromEnvVar("logRetentionInDays"),
      logLevel: getConfigFromEnvVar("logLevel"),
      environment: getConfigFromEnvVar("environment"),
      mutualTlsTrustStoreKey: props.isPullRequest ? undefined : getConfigFromEnvVar("trustStoreFile"),
      csocApiGatewayDestination: "arn:aws:logs:eu-west-2:693466633220:destination:api_gateway_log_destination",
      forwardCsocLogs: getBooleanConfigFromEnvVar("forwardCsocLogs"),
      deployCheckPrescriptionStatusUpdate: getBooleanConfigFromEnvVar("deployCheckPrescriptionStatusUpdate"),
      exposeGetStatusUpdates: getBooleanConfigFromEnvVar("exposeGetStatusUpdates"),
      enablePostDatedNotifications: getConfigFromEnvVar("enablePostDatedNotifications", undefined, "false"),
      requireApplicationName: getConfigFromEnvVar("requireApplicationName", undefined, "false"),
      enableBackup: getBooleanConfigFromEnvVar("enableBackup", undefined, "false")
    })
    return
  }

  // Stateful stacks use a stable (non-versioned) stack name so that the same
  // CloudFormation stack is updated in-place on every deployment rather than
  // creating a new stack per version.
  new PsuApiStatefulStack(app, "PsuApiStatefulStack", {
    ...props,
    stackName: modeAwareStackName,
    logRetentionInDays: getNumberConfigFromEnvVar("logRetentionInDays"),
    environment: getConfigFromEnvVar("environment"),
    enableDynamoDBAutoScaling: getBooleanConfigFromEnvVar("enableDynamoDBAutoScaling", undefined, "false"),
    enableBackup: getBooleanConfigFromEnvVar("enableBackup", undefined, "false"),
    enabledSiteOdsCodes: getConfigFromEnvVar("enabledSiteOdsCodes", undefined, " "),
    enabledSystems: getConfigFromEnvVar("enabledSystems", undefined, " "),
    enabledSupplierApplicationIds: getConfigFromEnvVar("enabledSupplierApplicationIds", undefined, " "),
    blockedSiteOdsCodes: getConfigFromEnvVar("blockedSiteOdsCodes", undefined, " "),
    notifyRoutingPlanId: getConfigFromEnvVar("notifyRoutingPlanId", undefined, " "),
    notifyApiBaseUrl: getConfigFromEnvVar("notifyApiBaseUrl", undefined, " "),
    enableNotificationsExternal: getConfigFromEnvVar("enableNotificationsExternal", undefined, "false"),
    enableNotificationsInternal: getConfigFromEnvVar("enableNotificationsInternal", undefined, "false"),
    testPrescriptions1: getConfigFromEnvVar("testPrescriptions1", undefined, "PLACEHOLDER"),
    testPrescriptions2: getConfigFromEnvVar("testPrescriptions2", undefined, "PLACEHOLDER"),
    testPrescriptions3: getConfigFromEnvVar("testPrescriptions3", undefined, "PLACEHOLDER"),
    testPrescriptions4: getConfigFromEnvVar("testPrescriptions4", undefined, "PLACEHOLDER")
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
