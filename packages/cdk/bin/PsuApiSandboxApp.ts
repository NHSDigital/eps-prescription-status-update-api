import {
  createApp,
  getBooleanConfigFromEnvVar,
  getConfigFromEnvVar,
  getNumberConfigFromEnvVar
} from "@nhsdigital/eps-cdk-constructs"
import {PsuApiSandboxStack} from "../stacks/PsuApiSandboxStack"

async function main() {
  const {app, props} = createApp({
    productName: "Prescription Status Update API",
    appName: "PsuApiSandboxApp",
    repoName: "eps-prescription-status-update-api",
    driftDetectionGroup: "psu-api"
  })

  new PsuApiSandboxStack(app, "PsuApiSandboxStack", {
    ...props,
    stackName: getConfigFromEnvVar("stackName"),
    logRetentionInDays: getNumberConfigFromEnvVar("logRetentionInDays"),
    logLevel: getConfigFromEnvVar("logLevel"),
    environment: getConfigFromEnvVar("environment"),
    trustStoreFile: getConfigFromEnvVar("trustStoreFile", undefined, "psu-sandbox-truststore.pem"),
    trustStoreVersion: getConfigFromEnvVar("trustStoreVersion", undefined, "none"),
    enableMutualTls: getBooleanConfigFromEnvVar("enableMutualTls", undefined, "false"),
    enableSplunk: getBooleanConfigFromEnvVar("enableSplunk", undefined, "false")
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
