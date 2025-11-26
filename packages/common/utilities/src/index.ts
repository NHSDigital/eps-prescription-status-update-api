// Log messages which are used for reporting purposes.
// Before editing, consider reviewing in-use splunk reports.
export {testPrescriptionsConfig, TestPrescriptionsConfig, getTestPrescriptions} from "./testConfig.js"
export const LOG_MESSAGES = {
  PSU0001: "Transitioning item status.",
  PSU0002: "Notify request",
  PSU0003: "Updated notification state",
  PSU0004: "Building data item for task."
} as const

export {initiatedSSMProvider} from "./ssmUtil.js"
