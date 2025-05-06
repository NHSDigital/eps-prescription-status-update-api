import defaultConfig from "../../jest.default.config"
import type {JestConfigWithTsJest} from "ts-jest"

const jestConfig: JestConfigWithTsJest = {
  ...defaultConfig,
  rootDir: "./",
  setupFiles: ["<rootDir>/.jest/setEnvVars.js"],
  coveragePathIgnorePatterns: ["<rootDir>/tests/"],
  coverageReporters: [
    "clover",
    "json",
    "text",
    ["lcov", {projectRoot: "../../"}]
  ]
}

export default jestConfig
