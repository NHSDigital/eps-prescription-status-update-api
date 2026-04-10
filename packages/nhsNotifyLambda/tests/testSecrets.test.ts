import {
  vi,
  describe,
  it,
  expect,
  beforeEach
} from "vitest"

const {mockGetSecret} = vi.hoisted(() => ({
  mockGetSecret: vi.fn<() => Promise<string | null>>()
}))

vi.mock(
  "@aws-lambda-powertools/parameters/secrets",
  async () => ({
    __esModule: true,
    getSecret: mockGetSecret
  })
)

const {loadSecrets} = await import("../src/utils/secrets.js")

describe("loadSecrets", () => {
  beforeEach(() => {
    process.env.API_KEY_SECRET = "api-key-secret-name"
    process.env.PRIVATE_KEY_SECRET = "private-key-secret-name"
    process.env.KID_SECRET = "kid-secret-name"
    vi.clearAllMocks()
  })

  it("should load and trim secrets successfully", async () => {
    mockGetSecret
      .mockResolvedValueOnce("  my-api-key  ")
      .mockResolvedValueOnce("my-private-key\n")
      .mockResolvedValueOnce(" my-kid ")

    const result = await loadSecrets()

    expect(result).toEqual({
      apiKey: "my-api-key",
      privateKey: "my-private-key",
      kid: "my-kid"
    })
  })

  it("should throw when API key is null", async () => {
    mockGetSecret
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("pk")
      .mockResolvedValueOnce("kid")

    await expect(loadSecrets()).rejects.toThrow(
      "Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager"
    )
  })

  it("should throw when private key is null", async () => {
    mockGetSecret
      .mockResolvedValueOnce("api")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("kid")

    await expect(loadSecrets()).rejects.toThrow(
      "Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager"
    )
  })

  it("should throw when KID is null", async () => {
    mockGetSecret
      .mockResolvedValueOnce("api")
      .mockResolvedValueOnce("pk")
      .mockResolvedValueOnce(null)

    await expect(loadSecrets()).rejects.toThrow(
      "Missing one of API_KEY, PRIVATE_KEY or KID from Secrets Manager"
    )
  })
})
