import {Backup} from "@aws-sdk/client-backup"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import {MiddyErrorHandler} from "@PrescriptionStatusUpdate_common/middyErrorHandler"

const logger = new Logger({serviceName: "psuRestoreValidationLambda"})
const errorResponseBody = {
  message: "There was a problem"
}

const middyErrorHandler = new MiddyErrorHandler(errorResponseBody)
const lambdaHandler = async (event) => {
  logger.debug("Handling event: ", {event})

  // Backup validation result
  const backup = new Backup()
  try {
    const response = await backup.putRestoreValidationResult({
      RestoreJobId: event.detail.restoreJobId,
      ValidationStatus: "SUCCESSFUL",
      ValidationStatusMessage: "Resource validation succeeded"
    })
    logger.info("PutRestoreValidationResult: ", {response})
  } catch (error) {
    console.error("Error putting restore validation result: ", error)
    throw error
  }

  console.log("Finished")
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        logger.info(request)
      }
    })
  )
  .use(middyErrorHandler({logger: logger}))
