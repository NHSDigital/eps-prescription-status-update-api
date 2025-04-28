import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import {logger} from "../updatePrescriptionStatus"

const enabledSiteODSCodes: Array<string> = [
  "ABC123"
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
  "DEF456"
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
    const odsCode = item.PharmacyODSCode

    // Is this item either ODS enabled, or supplier enabled?
    const isEnabledSystem = sitesSet.has(odsCode) || systemsSet.has(appName)
    if (!isEnabledSystem) {
      logger.info("Notifications disabled for dispensing site", {requestID: item.RequestID})
      return false
    }

    // Cannot have a blocked ODS code
    if (blockedSet.has(odsCode)) {
      logger.info("Notifications disabled for dispensing site", {requestID: item.RequestID})
      return false
    }

    return true
  })
}
