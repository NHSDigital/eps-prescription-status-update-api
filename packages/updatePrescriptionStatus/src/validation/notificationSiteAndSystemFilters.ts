import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import AWS from "aws-sdk"

const ssm = new AWS.SSM()

/**
 * Fetches the comma-delimited StringList from SSM, normalizes & returns a Set<string>.
 */
async function fetchListFromSSM(paramNameEnvVar: string): Promise<Set<string>> {
  const paramName = process.env[paramNameEnvVar]
  if (!paramName) {
    throw new Error(`Missing required env-var ${paramNameEnvVar}`)
  }
  const resp = await ssm
    .getParameter({Name: paramName, WithDecryption: false})
    .promise()

  const raw = resp.Parameter?.Value ?? ""
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

const listsReady: Promise<{
  enabledSiteODSCodes: Set<string>;
  enabledSystems: Set<string>;
  blockedSiteODSCodes: Set<string>;
}> = (async () => {
  const [enabledSiteODSCodes, enabledSystems, blockedSiteODSCodes] =
    await Promise.all([
      fetchListFromSSM("ENABLED_SITE_ODS_CODES"),
      fetchListFromSSM("ENABLED_SYSTEMS"),
      fetchListFromSSM("BLOCKED_SITE_ODS_CODES")
    ])
  return {enabledSiteODSCodes, enabledSystems, blockedSiteODSCodes}
})()

/**
 * Given an array of PSUDataItem, only returns those which:
 * - ARE enabled at a site OR system level,
 * - AND are NOT blocked at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @returns - the filtered array
 */
export async function checkSiteOrSystemIsNotifyEnabled(
  data: Array<PSUDataItem>
): Promise<Array<PSUDataItem>> {
  const {
    enabledSiteODSCodes,
    enabledSystems,
    blockedSiteODSCodes
  } = await listsReady

  return data.filter((item) => {
    const appName = item.ApplicationName.toLowerCase()
    const odsCode = item.PharmacyODSCode.toLowerCase()

    // Is this item either ODS enabled, or supplier enabled?
    const isEnabledSystem = enabledSiteODSCodes.has(odsCode) || enabledSystems.has(appName)
    if (!isEnabledSystem) {
      return false
    }

    // Cannot have a blocked ODS code
    if (blockedSiteODSCodes.has(odsCode)) {
      return false
    }

    return true
  })
}
