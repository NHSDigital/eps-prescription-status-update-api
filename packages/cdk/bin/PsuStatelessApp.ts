import {
  calculateVersionedStackName,
  createApp,
  getBooleanConfigFromEnvVar,
  getConfigFromEnvVar,
  getNumberConfigFromEnvVar
} from "@nhsdigital/eps-cdk-constructs"
import {PsuStatelessStack} from "../stacks/PsuStatelessStack"

async function main() {
  const {app, props} = createApp({
    productName: "Prescription Status Update API",
    appName: "PsuStatelessApp",
    repoName: "eps-prescription-status-update-api",
    driftDetectionGroup: "psu-api"
  })

  new PsuStatelessStack(app, "PsuStatelessStack", {
    ...props,
    stackName: calculateVersionedStackName(getConfigFromEnvVar("stackName"), props),
    logRetentionInDays: getNumberConfigFromEnvVar("logRetentionInDays"),
    mutualTlsTrustStoreKey: props.isPullRequest ? undefined : getConfigFromEnvVar("trustStoreFile"),
    csocApiGatewayDestination: "arn:aws:logs:eu-west-2:693466633220:destination:api_gateway_log_destination",
    forwardCsocLogs: getBooleanConfigFromEnvVar("forwardCsocLogs"),
    deployCheckPrescriptionStatusUpdate: getBooleanConfigFromEnvVar("deployCheckPrescriptionStatusUpdate"),
    exposeGetStatusUpdates: getBooleanConfigFromEnvVar("exposeGetStatusUpdates")
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
