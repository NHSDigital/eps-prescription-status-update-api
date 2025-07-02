import {SSMProvider} from "@aws-lambda-powertools/parameters/ssm"

const ssm = new SSMProvider()

export interface NotifyConfig {
  makeRealNotifyRequests: boolean
  notifyApiBaseUrlRaw: string
}

export async function loadConfig(): Promise<{
  makeRealNotifyRequests: boolean,
  notifyApiBaseUrlRaw: string
}> {
  const paramNames = {
    [process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!]: {maxAge: 5},
    [process.env.NOTIFY_API_BASE_URL_PARAM!]: {maxAge: 5}
  }
  const all = await ssm.getParametersByName(paramNames)

  // make sure that the MAKE_REAL_NOTIFY_REQUESTS_PARAM parameter value is a string, and lowercase
  const realNotifyParam = (all[process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!] as string)
    .toString()
    .toLowerCase()
    .trim()

  return {
    makeRealNotifyRequests: realNotifyParam === "true",
    notifyApiBaseUrlRaw: all[process.env.NOTIFY_API_BASE_URL_PARAM!] as string
  }
}
