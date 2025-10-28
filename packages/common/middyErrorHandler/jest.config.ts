import defaultConfig from "../../../jest.default.config"
import type {JestConfigWithTsJest} from "ts-jest"

const jestConfig: JestConfigWithTsJest = {
  ...defaultConfig,
  rootDir: "./",
  // Override module mapper paths for packages in common/ subdirectory
  moduleNameMapper: {
    ...defaultConfig.moduleNameMapper,
    "^@PrescriptionStatusUpdate_common/commonTypes$": "<rootDir>/../commonTypes/src",
    "^@PrescriptionStatusUpdate_common/middyErrorHandler$": "<rootDir>/src",
    "^@PrescriptionStatusUpdate_common/testing$": "<rootDir>/../testing/src"
  }
}

export default jestConfig
