import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

const whitelistedSiteODSCodes: Array<string> = [
  "ABC123"
]

// Whitelisted supplier names
const whitelistedSystems: Array<string> = [
  "Internal Test System",
  "Apotec Ltd - Apotec CRM - Production",
  "CrxPatientApp",
  "nhsPrescriptionApp",
  "Titan PSU Prod"
]

const blacklistedSiteODSCodes: Array<string> = [
  "DEF456"
]

/**
 * Given an array of PSUDataItem, only returns those which ARE whitelisted at a site or system level,
 * AND are NOT blacklisted at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @returns - the filtered array
 */
export function checkSiteOrSystemIsNotifyWhitelisted(
  data: Array<PSUDataItem>
): Array<PSUDataItem> {
  // Make everything lowercase, so we're case insensitive
  const sitesSet = new Set(whitelistedSiteODSCodes.map((s) => s.toLowerCase()))
  const systemsSet = new Set(whitelistedSystems.map((s) => s.toLowerCase()))
  const blacklistedSet = new Set(blacklistedSiteODSCodes)

  return data.filter((item) => {
    const appName = item.ApplicationName.toLowerCase()
    const odsCode = item.PharmacyODSCode

    // Is this item either ODS whitelisted, or supplier whitelisted?
    const isWhitelistedSystem = sitesSet.has(odsCode) || systemsSet.has(appName)
    if (!isWhitelistedSystem) return false

    // Cannot have a blacklisted ODS code
    if (blacklistedSet.has(odsCode)) return false

    return true
  })
}
