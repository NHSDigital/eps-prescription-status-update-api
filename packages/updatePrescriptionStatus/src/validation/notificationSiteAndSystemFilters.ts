import {PSUDataItemWithPrevious} from "@psu-common/commonTypes"
import {initiatedSSMProvider} from "@psu-common/utilities"
import {Logger} from "@aws-lambda-powertools/logger"

const USE_PRODUCT_ID_FOR_NOTIFICATIONS_FILTERING =
  (process.env.USE_PRODUCT_ID_FOR_NOTIFICATIONS_FILTERING || "false")
    .toLowerCase() === "true"

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
  enabledSystemAppNames: Set<string>,
  enabledSystemAppIds: Set<string>,
  blockedSiteODSCodes: Set<string>
}> {
  const paramNames = {
    [process.env.ENABLED_SITE_ODS_CODES_PARAM!]: {maxAge: 5},
    [process.env.ENABLED_SYSTEMS_PARAM!]: {maxAge: 5},
    [process.env.ENABLED_PRODUCT_IDS_PARAM!]: {maxAge: 5},
    [process.env.BLOCKED_SITE_ODS_CODES_PARAM!]: {maxAge: 5}
  }
  const all = await initiatedSSMProvider.getParametersByName(paramNames)

  const enabledSiteODSCodes = str2set(all[process.env.ENABLED_SITE_ODS_CODES_PARAM!] as string)
  const enabledSystemAppNames = str2set(all[process.env.ENABLED_SYSTEMS_PARAM!] as string)
  const enabledSystemAppIds = str2set(all[process.env.ENABLED_PRODUCT_IDS_PARAM!] as string)
  const blockedSiteODSCodes = str2set(all[process.env.BLOCKED_SITE_ODS_CODES_PARAM!] as string)

  return {
    enabledSiteODSCodes,
    enabledSystemAppNames,
    enabledSystemAppIds,
    blockedSiteODSCodes
  }
}

/**
 * Given an array of PSUDataItem, only returns those which:
 * - ARE enabled at a site OR system level,
 * - AND are NOT blocked at the site level.
 *
 * @param data - Array of PSUDataItem to be processed
 * @param logger - Optional logger instance
 * @returns - the filtered array
 */
export async function checkSiteOrSystemIsNotifyEnabled(
  data: Array<PSUDataItemWithPrevious>,
  logger?: Logger
): Promise<Array<PSUDataItemWithPrevious>> {
  // Get the configuration from either the cache or SSM
  const {enabledSiteODSCodes, enabledSystemAppNames, enabledSystemAppIds, blockedSiteODSCodes} = await loadConfig()
  const unfilteredItemCount = data.length

  const filteredItems = data.filter((item) => {
    const appId = item.current.ApplicationID.trim().toLowerCase()
    const appName = item.current.ApplicationName.trim().toLowerCase()
    const odsCode = item.current.PharmacyODSCode.trim().toLowerCase()

    logger?.info(
      "Product ID, application name, and ODS code",
      {productId: appId, applicationName: appName, odsCode, enabledSystemAppIds}
    )

    // Is this item supplier enabled?
    if (USE_PRODUCT_ID_FOR_NOTIFICATIONS_FILTERING) {
      const isEnabledProduct = enabledSiteODSCodes.has(odsCode) || enabledSystemAppIds.has(appId)
      if (!isEnabledProduct) {
        return false
      }
    } else {
      const isEnabledSystem = enabledSiteODSCodes.has(odsCode) || enabledSystemAppNames.has(appId)
      if (!isEnabledSystem) {
        return false
      }
    }

    // Cannot have a blocked ODS code
    if (blockedSiteODSCodes.has(odsCode)) {
      return false
    }

    return true
  })

  if (logger) {
    logger.info(
      "Filtered out sites and suppliers that are not enabled, or are explicitly disabled",
      {numItemsReceived: unfilteredItemCount, numItemsAllowed: filteredItems.length}
    )
  }

  return filteredItems
}
