import {defineConfig, mergeConfig} from "vitest/config"
import defaultConfig from "../../vitest.default.config.ts"

export default mergeConfig(defaultConfig, defineConfig({
  root: "./",
  test: {
    globals: true,
    setupFiles: ["./.vitest/setup-env.js"]
  }
}))
