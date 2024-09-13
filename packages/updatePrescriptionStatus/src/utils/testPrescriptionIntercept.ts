import {Logger} from "@aws-lambda-powertools/logger"
import {LAMBDA_TIMEOUT_MS} from "../updatePrescriptionStatus"
import {checkPrescriptionRecordExistence} from "./databaseClient"
import {hasTimedOut, jobWithTimeout} from "./timeoutUtils"
export interface InterceptionResult {
  testPrescriptionForcedError?: boolean
  testPrescription1Forced201?: boolean
}

export async function testPrescription1Intercept(
  logger: Logger,
  matchingPrescriptionID: string,
  taskID: string
): Promise<InterceptionResult> {
  logger.info("Intercepted INT test prescription 1. Checking for existing records.")

  const prescription1RecordsExist = await jobWithTimeout(
    LAMBDA_TIMEOUT_MS,
    checkPrescriptionRecordExistence(matchingPrescriptionID, taskID, logger)
  )
  if (hasTimedOut(prescription1RecordsExist)) {
    logger.info("Querying dynamo for INT test prescription 1 timed out. Continuing.")
    return {}
  }

  let testPrescriptionForcedError = false
  let testPrescription1Forced201 = false
  if (!prescription1RecordsExist) {
    logger.info("First submission of INT test prescription 1, returning 500")
    testPrescriptionForcedError = true
  } else {
    logger.info("Not first submission of INT test prescription 1, forcing 201")
    testPrescription1Forced201 = true
  }

  return {testPrescriptionForcedError, testPrescription1Forced201}
}

export async function testPrescription2Intercept(
  logger: Logger,
  matchingPrescriptionID: string,
  taskID: string
): Promise<InterceptionResult> {
  logger.info("Intercepted INT test prescription 2. Checking for existing records.")

  const prescription2RecordsExist = await jobWithTimeout(
    LAMBDA_TIMEOUT_MS,
    checkPrescriptionRecordExistence(matchingPrescriptionID, taskID, logger)
  )
  if (hasTimedOut(prescription2RecordsExist)) {
    logger.info("Querying dynamo for INT test prescription 2 timed out. Continuing.")
    return {}
  }

  let testPrescriptionForcedError = false
  if (!prescription2RecordsExist) {
    logger.info("First submission of INT test prescription 2. Updating store then returning 500")
    testPrescriptionForcedError = true
  } else {
    logger.info("Not first submission of INT test prescription 2, continuing")
  }

  return {testPrescriptionForcedError}
}
