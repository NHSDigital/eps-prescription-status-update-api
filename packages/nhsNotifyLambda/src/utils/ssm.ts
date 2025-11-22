import {SSMProvider} from "@aws-lambda-powertools/parameters/ssm"

const ssm = new SSMProvider()

export interface NotifyConfig {
  makeRealNotifyRequestsFlag: boolean
  notifyApiBaseUrl: string
}

export async function loadConfig(): Promise<NotifyConfig> {
  const paramNames = {
    [process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!]: {maxAge: 1},
    [process.env.NOTIFY_API_BASE_URL_PARAM!]: {maxAge: 1}
  }
  const all = await ssm.getParametersByName(paramNames)

  // make sure that the MAKE_REAL_NOTIFY_REQUESTS_PARAM parameter value is a string, and lowercase
  const realNotifyParam = (all[process.env.MAKE_REAL_NOTIFY_REQUESTS_PARAM!] as string)
    .toString()
    .toLowerCase()
    .trim()

  return {
    makeRealNotifyRequestsFlag: realNotifyParam === "true",
    // secrets may be bytes, so make sure it's a string, then trim
    notifyApiBaseUrl: (all[process.env.NOTIFY_API_BASE_URL_PARAM!] as string).toString().trim()
  }
}
