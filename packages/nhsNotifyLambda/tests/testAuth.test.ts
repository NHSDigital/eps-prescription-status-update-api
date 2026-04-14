import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach
} from "vitest"
import nock from "nock"

import {Logger} from "@aws-lambda-powertools/logger"
import axios, {AxiosInstance} from "axios"

const {mockImportPKCS8, mockSignJWTConstructor} = vi.hoisted(() => ({
  mockImportPKCS8: vi.fn(),
  mockSignJWTConstructor: vi.fn()
}))

vi.mock("jose", async () => ({
  __esModule: true,
  importPKCS8: mockImportPKCS8,
  SignJWT: mockSignJWTConstructor
}))

let tokenExchange: (
  logger: Logger,
  axiosInstance: AxiosInstance,
  host: string,
  notifySecrets: {apiKey: string; privateKey: string; kid: string}
) => Promise<string>

beforeAll(async () => {
  ({tokenExchange} = await import("../src/utils/auth.js"))
})

describe("tokenExchange", () => {
  const host = "https://notify.example.com"

  let logger: Logger

  let axiosInstance: AxiosInstance

  beforeEach(() => {
    vi.clearAllMocks()
    logger = new Logger({serviceName: "test-service"})

    axiosInstance = axios.create({baseURL: host})
  })

  it("should successfully exchange secrets for a bearer token", async () => {
    const notifySecrets = {
      apiKey: "myApiKey",
      privateKey: "my\nPrivate\nKey",
      kid: "myKid"
    }

    // Mock jose
    mockImportPKCS8.mockImplementation(() => Promise.resolve("imported-key-object"))
    const fakeJwtInstance = {
      setProtectedHeader: function () {
        return this
      },
      setIssuedAt: function () {
        return this
      },
      setExpirationTime: function () {
        return this
      },
      sign: vi.fn().mockImplementation(() => Promise.resolve("signed.jwt.token"))
    }
    mockSignJWTConstructor.mockImplementation(function() {
      return fakeJwtInstance
    })

    // Mock the HTTP call
    nock(`${host}`)
      .post("/oauth2/token", (body) => {
        // if Nock gives a raw string:
        if (typeof body === "string") {
          return (
            body.includes("grant_type=client_credentials") &&
            body.includes("client_assertion=signed.jwt.token")
          )
        }
        // otherwise it's the parsed object
        return (
          body.grant_type === "client_credentials" &&
          body.client_assertion === "signed.jwt.token"
        )
      })
      .reply(200, {access_token: "access-token-xyz"})

    const bearerToken = await tokenExchange(logger, axiosInstance, host, notifySecrets)

    expect(bearerToken).toBe("access-token-xyz")
  })

  it("should throw if HTTP response is non-200", async () => {
    const notifySecrets = {
      apiKey: "v",
      privateKey: "v",
      kid: "v"
    }

    mockImportPKCS8.mockImplementation(() => Promise.resolve("imported"))
    mockSignJWTConstructor.mockImplementation(function() {
      return ({
        setProtectedHeader() {
          return this
        },
        setIssuedAt() {
          return this
        },
        setExpirationTime() {
          return this
        },
        sign: vi.fn().mockImplementation(() => Promise.resolve("jwt-tkn"))
      })
    })

    nock(`${host}`)
      .post("/oauth2/token")
      .reply(500, {error: "oops"})

    await expect(tokenExchange(logger, axiosInstance, host, notifySecrets)).rejects.toThrow(
      "Request failed with status code 500"
    )
  })

  it("should throw if access_token is missing in 200 response", async () => {
    const notifySecrets = {
      apiKey: "v",
      privateKey: "v",
      kid: "v"
    }

    mockImportPKCS8.mockImplementation(() => Promise.resolve("imported"))
    mockSignJWTConstructor.mockImplementation(function() {
      return ({
        setProtectedHeader() {
          return this
        },
        setIssuedAt() {
          return this
        },
        setExpirationTime() {
          return this
        },
        sign: vi.fn().mockImplementation(() => Promise.resolve("jwt-tkn"))
      })
    })

    nock(`${host}`)
      .post("/oauth2/token")
      .reply(200, {not_token: "nope"})

    await expect(tokenExchange(logger, axiosInstance, host, notifySecrets)).rejects.toThrow(
      "No token in response"
    )
  })
})
