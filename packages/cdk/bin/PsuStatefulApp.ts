import {
  createApp,
  getBooleanConfigFromEnvVar,
  getConfigFromEnvVar,
  getNumberConfigFromEnvVar
} from "@nhsdigital/eps-cdk-constructs"
import {PsuStatefulStack} from "../stacks/PsuStatefulStack"

async function main() {
  const {app, props} = createApp({
    productName: "Prescription Status Update API",
    appName: "PsuStatefulApp",
    repoName: "eps-prescription-status-update-api",
    driftDetectionGroup: "psu-api"
  })

  // Stateful stacks use a stable (non-versioned) stack name so that the same
  // CloudFormation stack is updated in-place on every deployment rather than
  // creating a new stack per version.
  new PsuStatefulStack(app, "PsuStatefulStack", {
    ...props,
    stackName: getConfigFromEnvVar("stackName"),
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
