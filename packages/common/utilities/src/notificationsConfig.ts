import {initiatedSSMProvider} from "./ssmUtil"

export async function getNotificationsConfig() {
  const paramNames = {
    [process.env.ENABLE_NOTIFICATIONS_PARAM!]: {maxAge: 5}
  }
  const all = await initiatedSSMProvider.getParametersByName(paramNames)

  const enableNotificationsValue = (all[process.env.ENABLE_NOTIFICATIONS_PARAM!] as string)
    .toString()
    .trim()
    .toLowerCase()

  return {
    enableNotifications: enableNotificationsValue === "true"
  }
}

export default getNotificationsConfig()
