import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

function getEnvList(name: string): Set<string> {
  const raw = process.env[name] ?? ""
  return new Set(raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) // Remove empty entries
  )
}

const enabledSiteODSCodes = getEnvList("ENABLED_SITE_ODS_CODES")
const enabledSystems = getEnvList("ENABLED_SYSTEMS")
const blockedSiteODSCodes = getEnvList("BLOCKED_SITE_ODS_CODES")

/**
 * Given an array of PSUDataItem, only returns those which:
 * - ARE enabled at a site OR system level,
 * - AND are NOT blocked at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @returns - the filtered array
 */
export function checkSiteOrSystemIsNotifyEnabled(
  data: Array<PSUDataItem>
): Array<PSUDataItem> {
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
