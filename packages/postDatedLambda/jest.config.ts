import type {JestConfigWithTsJest} from "ts-jest"
import defaultConfig from "../../jest.default.config"

const jestConfig: JestConfigWithTsJest = {
  ...defaultConfig,
  rootDir: "./",
  setupFiles: ["<rootDir>/.jest/setEnvVars.js"]
}

export default jestConfig
