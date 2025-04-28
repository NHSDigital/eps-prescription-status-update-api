import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"

const enabledSiteODSCodes: Array<string> = [
  "FA565"
]

// Enabled supplier names
const enabledSystems: Array<string> = [
  "Internal Test System",
  "Apotec Ltd - Apotec CRM - Production",
  "CrxPatientApp",
  "nhsPrescriptionApp",
  "Titan PSU Prod"
]

const blockedSiteODSCodes: Array<string> = [
  "A83008"
]

/**
 * Given an array of PSUDataItem, only returns those which ARE enabled at a site or system level,
 * AND are NOT blocked at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @returns - the filtered array
 */
export function checkSiteOrSystemIsNotifyEnabled(
  data: Array<PSUDataItem>
): Array<PSUDataItem> {
  // Make everything lowercase, so we're case insensitive
  const sitesSet = new Set(enabledSiteODSCodes.map((s) => s.toLowerCase()))
  const systemsSet = new Set(enabledSystems.map((s) => s.toLowerCase()))

  const blockedSet = new Set(blockedSiteODSCodes.map((s) => s.toLowerCase()))

  return data.filter((item) => {
    const appName = item.ApplicationName.toLowerCase()
    const odsCode = item.PharmacyODSCode.toLowerCase()

    // Is this item either ODS enabled, or supplier enabled?
    const isEnabledSystem = sitesSet.has(odsCode) || systemsSet.has(appName)
    if (!isEnabledSystem) {
      return false
    }

    // Cannot have a blocked ODS code
    if (blockedSet.has(odsCode)) {
      return false
    }

    return true
  })
}
