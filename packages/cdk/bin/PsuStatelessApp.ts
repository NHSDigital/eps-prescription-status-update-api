import {calculateVersionedStackName, createApp, getConfigFromEnvVar} from "@nhsdigital/eps-cdk-constructs"
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
    stackName: calculateVersionedStackName(getConfigFromEnvVar("stackName"), props)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
