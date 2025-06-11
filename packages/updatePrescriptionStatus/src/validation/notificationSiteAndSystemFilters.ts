import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import {getParameter} from "@aws-lambda-powertools/parameters/ssm"

async function getEnvList(name: string): Promise<Set<string>> {
  if (!process.env[name]) throw new Error(`${process.env[name]} is not defined in the environment variables!`)
  const value = await getParameter(process.env[name])
  const raw = value ?? ""
  return new Set(raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) // Remove empty entries
  )
}

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
  const enabledSiteODSCodes = await getEnvList("ENABLED_SITE_ODS_CODES_PARAM")
  const enabledSystems = await getEnvList("ENABLED_SYSTEMS_PARAM")
  const blockedSiteODSCodes = await getEnvList("BLOCKED_SITE_ODS_CODES_PARAM")

  return data.filter((item) => {
    const appName = item.ApplicationName.trim().toLowerCase()
    const odsCode = item.PharmacyODSCode.trim().toLowerCase()

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
