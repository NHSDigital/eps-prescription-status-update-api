import {Backup} from "@aws-sdk/client-backup"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import {MiddyErrorHandler} from "@PrescriptionStatusUpdate_common/middyErrorHandler"
import {compareTables} from "./compareTable"

const logger = new Logger({serviceName: "psuRestoreValidationLambda"})
const errorResponseBody = {
  message: "There was a problem"
}

const middyErrorHandler = new MiddyErrorHandler(errorResponseBody)
const client = new DynamoDBClient()
const docClient = DynamoDBDocumentClient.from(client)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lambdaHandler = async (event: any) => {
  const sourceTableArn = event.detail.sourceResourceArn
  const restoredTableArn = event.detail.createdResourceArn
  logger.debug("Use the following arn for verification", {sourceTableArn, restoredTableArn})
  const backup = new Backup()
  const result = await compareTables(sourceTableArn, restoredTableArn, docClient, logger)
  try {
    if(result) {
      logger.info("Compare tables successful")
      const response = await backup.putRestoreValidationResult({
        RestoreJobId: event.detail.restoreJobId,
        ValidationStatus: "SUCCESSFUL",
        ValidationStatusMessage: "Resource validation succeeded"
      })
      logger.info("PutRestoreValidationResult: ", {response})
    } else {
      logger.info("Compare tables failed")
      const response = await backup.putRestoreValidationResult({
        RestoreJobId: event.detail.restoreJobId,
        ValidationStatus: "FAILED",
        ValidationStatusMessage: "Resource validation succeeded"
      })
      logger.info("PutRestoreValidationResult: ", {response})

    }
  } catch (error) {
    logger.error("Error putting restore validation result: ", {error})
    throw error
  }

  logger.info("Finished")
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
  .use(middyErrorHandler.errorHandler({logger: logger}))
