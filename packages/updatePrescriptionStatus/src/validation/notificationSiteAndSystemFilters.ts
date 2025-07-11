import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import {SSMProvider} from "@aws-lambda-powertools/parameters/ssm"

const ssm = new SSMProvider()

function str2set(value: string | undefined): Set<string> {
  const raw = value ?? ""
  return new Set(raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) // Remove empty entries
  )
}

async function loadConfig(): Promise<{
  enabledSiteODSCodes: Set<string>,
  enabledSystems: Set<string>,
  blockedSiteODSCodes: Set<string>
}> {
  const paramNames = {
    [process.env.ENABLED_SITE_ODS_CODES_PARAM!]: {maxAge: 5},
    [process.env.ENABLED_SYSTEMS_PARAM!]: {maxAge: 5},
    [process.env.BLOCKED_SITE_ODS_CODES_PARAM!]: {maxAge: 5}
  }
  const all = await ssm.getParametersByName(paramNames)

  const enabledSiteODSCodes = str2set(all[process.env.ENABLED_SITE_ODS_CODES_PARAM!] as string)
  const enabledSystems = str2set(all[process.env.ENABLED_SYSTEMS_PARAM!] as string)
  const blockedSiteODSCodes = str2set(all[process.env.BLOCKED_SITE_ODS_CODES_PARAM!] as string)

  return {
    enabledSiteODSCodes,
    enabledSystems,
    blockedSiteODSCodes
  }
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
  // Get the configuration from either the cache or SSM
  const {enabledSiteODSCodes, enabledSystems, blockedSiteODSCodes} = await loadConfig()

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
