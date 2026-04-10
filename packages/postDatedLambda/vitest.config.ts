import {defineConfig, mergeConfig} from "vitest/config"
import defaultConfig from "../../vitest.default.config.ts"

export default mergeConfig(defaultConfig, defineConfig({
  root: "./",
  test: {
    minWorkers: 1,
    maxWorkers: 1,
    setupFiles: ["./.vitest/setup-env.js"]
  }
}))
