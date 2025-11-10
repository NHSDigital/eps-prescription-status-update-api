import {getSecret} from "@aws-lambda-powertools/parameters/secrets"
import {initiatedSSMProvider} from "./ssmUtil"

export interface TestPrescriptionsConfig {
  getTestPrescriptions(param: keyof typeof TestPrescriptions): Promise<Array<string>>
}

export class TestPrescriptions implements TestPrescriptionsConfig {
  // Parameter names via environment variables for test prescriptions
  // or default names if environment variables are not set for testing
  // environment variables set by SSM parameter resource name defined in SAM template
  static readonly TEST_PRESCRIPTIONS_PARAM_1 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_1 || "TEST_PRESCRIPTIONS_1")
  static readonly TEST_PRESCRIPTIONS_PARAM_2 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_2 || "TEST_PRESCRIPTIONS_2")
  static readonly TEST_PRESCRIPTIONS_PARAM_3 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_3 || "TEST_PRESCRIPTIONS_3")
  static readonly TEST_PRESCRIPTIONS_PARAM_4 = (process.env.TEST_PRESCRIPTIONS_PARAM_NAME_4 || "TEST_PRESCRIPTIONS_4")

  private ssmProvider

  constructor(ssmProvider: typeof initiatedSSMProvider) {
    this.ssmProvider = ssmProvider
  }

  async getTestPrescriptions(param: keyof typeof TestPrescriptions): Promise<Array<string>> {
    const paramName = (TestPrescriptions[param] as string)
    const prescriptions = new Array<string>()

    const paramValues = await this.ssmProvider.get(paramName) as string

    if (paramValues.length > 0) {
      paramValues
        .toString()
        .split(",")
        .map(p => p.trim())
        .forEach(p => prescriptions.push(p))
    } else {
      return []
    }

    return prescriptions
  }
}

export const testPrescriptionsConfig = new TestPrescriptions(initiatedSSMProvider)
export const getTestPrescriptions = testPrescriptionsConfig.getTestPrescriptions.bind(testPrescriptionsConfig)

export interface NotifyConfig {
  getApiKey(): Promise<string>
  getPrivateKey(): Promise<string>
  getKid(): Promise<string>
}

export class NotifySecretsManagerConfig implements NotifyConfig {
  // Secret names via environment variables for NHS Notify credentials
  static readonly API_KEY_SECRET = process.env.API_KEY_SECRET!
  static readonly PRIVATE_KEY_SECRET = process.env.PRIVATE_KEY_SECRET!
  static readonly KID_SECRET = process.env.KID_SECRET!

  async getApiKey(): Promise<string> {
    const apiKeyRaw = await getSecret(NotifySecretsManagerConfig.API_KEY_SECRET)
    const apiKey = apiKeyRaw?.toString().trim()
    
    if (!apiKey) {
      throw new Error("Missing API_KEY from Secrets Manager")
    }
    
    return apiKey
  }

  async getPrivateKey(): Promise<string> {
    const privateKeyRaw = await getSecret(NotifySecretsManagerConfig.PRIVATE_KEY_SECRET)
    const privateKey = privateKeyRaw?.toString().trim()
    
    if (!privateKey) {
      throw new Error("Missing PRIVATE_KEY from Secrets Manager")
    }
    
    return privateKey
  }

  async getKid(): Promise<string> {
    const kidRaw = await getSecret(NotifySecretsManagerConfig.KID_SECRET)
    const kid = kidRaw?.toString().trim()
    
    if (!kid) {
      throw new Error("Missing KID from Secrets Manager")
    }
    
    return kid
  }
}

export const notifyConfig = new NotifySecretsManagerConfig()
export const getNotifyConfig = (): NotifySecretsManagerConfig => notifyConfig
