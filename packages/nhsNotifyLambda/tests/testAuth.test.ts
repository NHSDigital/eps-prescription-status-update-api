import {jest} from "@jest/globals"
import {SpiedFunction} from "jest-mock"
import nock from "nock"

import {Logger} from "@aws-lambda-powertools/logger"

const mockGetSecret = jest.fn()
jest.unstable_mockModule(
  "@aws-lambda-powertools/parameters/secrets",
  async () => ({
    __esModule: true,
    getSecret: mockGetSecret
  })
)

const mockImportPKCS8 = jest.fn()
const mockSignJWTConstructor = jest.fn()
jest.unstable_mockModule("jose", async () => ({
  __esModule: true,
  importPKCS8: mockImportPKCS8,
  SignJWT: mockSignJWTConstructor
}))

const mockUuidv4 = jest.fn()
jest.unstable_mockModule("uuid", async () => ({
  __esModule: true,
  v4: mockUuidv4
}))

let tokenExchange: (logger: Logger, host: string) => Promise<string>
beforeAll(async () => {
  ({tokenExchange} = await import("../src/utils/auth"))
})

describe("tokenExchange", () => {
  const host = "https://notify.example.com"

  let logger: Logger
  let errorSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>
  let infoSpy: SpiedFunction<(msg: string, ...meta: Array<unknown>) => void>

  beforeEach(() => {
    jest.clearAllMocks()
    logger = new Logger({serviceName: "test-service"})
    errorSpy = jest.spyOn(logger, "error")
    infoSpy = jest.spyOn(logger, "info")
  })

  it("should successfully exchange secrets for a bearer token", async () => {
    // Mock getSecret for API_KEY, PRIVATE_KEY, KID (in that order)
    mockGetSecret
      .mockImplementationOnce(() => Promise.resolve("  myApiKey  "))
      .mockImplementationOnce(() => Promise.resolve("my\nPrivate\nKey"))
      .mockImplementationOnce(() => Promise.resolve(" myKid "))

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
      sign: jest.fn().mockImplementation(() => Promise.resolve("signed.jwt.token"))
    }
    mockSignJWTConstructor.mockImplementation(() => fakeJwtInstance)

    // Mock uuid
    mockUuidv4.mockReturnValue("uuid-1234")

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

    const bearerToken = await tokenExchange(logger, host)

    expect(bearerToken).toBe("access-token-xyz")
    expect(infoSpy).toHaveBeenCalledWith(
      "Exchanging JWT for access token",
      expect.objectContaining({host, jti: "uuid-1234"})
    )
    expect(infoSpy).toHaveBeenCalledWith("Token exchange successful")
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("should throw if any secret is missing", async () => {
    mockGetSecret
      .mockImplementationOnce(() => Promise.resolve(null)) // API_KEY missing
      .mockImplementationOnce(() => Promise.resolve("x"))
      .mockImplementationOnce(() => Promise.resolve("y"))

    await expect(tokenExchange(logger, host)).rejects.toThrow(
      "Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager"
    )
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it("should throw if HTTP response is non-200", async () => {
    // all secrets present
    mockGetSecret
      .mockImplementation(() => Promise.resolve("v"))
    mockImportPKCS8.mockImplementation(() => Promise.resolve("imported"))
    mockSignJWTConstructor.mockImplementation(() => ({
      setProtectedHeader() {
        return this
      },
      setIssuedAt() {
        return this
      },
      setExpirationTime() {
        return this
      },
      sign: jest.fn().mockImplementation(() => Promise.resolve("jwt-tkn"))
    }))
    mockUuidv4.mockReturnValue("uid")

    nock(`${host}`)
      .post("/oauth2/token")
      .reply(500, {error: "oops"})

    await expect(tokenExchange(logger, host)).rejects.toThrow(
      "Failed to exchange token"
    )
    expect(errorSpy).toHaveBeenCalledWith(
      "Token exchange failed",
      expect.objectContaining({status: 500, body: {error: "oops"}})
    )
  })

  it("should throw if access_token is missing in 200 response", async () => {
    mockGetSecret.mockImplementation(() => Promise.resolve("v"))
    mockImportPKCS8.mockImplementation(() => Promise.resolve("imported"))
    mockSignJWTConstructor.mockImplementation(() => ({
      setProtectedHeader() {
        return this
      },
      setIssuedAt() {
        return this
      },
      setExpirationTime() {
        return this
      },
      sign: jest.fn().mockImplementation(() => Promise.resolve("jwt-tkn"))
    }))
    mockUuidv4.mockReturnValue("uid")

    nock(`${host}`)
      .post("/oauth2/token")
      .reply(200, {not_token: "nope"})

    await expect(tokenExchange(logger, host)).rejects.toThrow(
      "Failed to exchange token"
    )
    expect(errorSpy).toHaveBeenCalledWith(
      "Token exchange failed",
      expect.objectContaining({status: 200, body: {not_token: "nope"}})
    )
  })
})
