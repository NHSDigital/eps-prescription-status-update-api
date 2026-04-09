import {defineConfig} from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

const vitestConfig = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    clearMocks: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov"],
      exclude: [
        "**/node_modules/**",
        "**/lib/**",
        "**/coverage/**",
        "**/tests/**",
        "**/*.config.ts",
        "**/*.d.ts",
        "**/vitest.default.config.ts"
      ]
    }
  }
})

export default vitestConfig
