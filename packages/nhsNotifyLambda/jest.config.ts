import defaultConfig from "../../jest.default.config"
import type {JestConfigWithTsJest} from "ts-jest"

const jestConfig: JestConfigWithTsJest = {
  ...defaultConfig,
  "rootDir": "./",
  setupFiles: ["<rootDir>/.jest/setEnvVars.js"],
  coveragePathIgnorePatterns: [
    "<rootDir>/tests/"
  ],
  collectCoverage: true,
  coverageDirectory: "coverage",
  // overwrite the default reporters to include our custom LCOV config
  coverageReporters: [
    "json",
    "text",
    ["lcov", {projectRoot: "<rootDir>"}],
    "clover"
  ]
}

export default jestConfig
