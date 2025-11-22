import {getSecret} from "@aws-lambda-powertools/parameters/secrets"

export interface NotifySecrets {
  apiKey: string, privateKey: string, kid: string
}

export async function loadSecrets(): Promise<NotifySecrets> {
  const [apiKeyRaw, privateKeyRaw, kidRaw] = await Promise.all([
    getSecret(process.env.API_KEY_SECRET!),
    getSecret(process.env.PRIVATE_KEY_SECRET!),
    getSecret(process.env.KID_SECRET!)
  ])

  if (!apiKeyRaw || !privateKeyRaw || !kidRaw) {
    throw new Error("Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager")
  }
  return {
    apiKey: apiKeyRaw.toString().trim(),
    privateKey: privateKeyRaw.toString().trim(),
    kid: kidRaw.toString().trim()
  }
}
