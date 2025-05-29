import {Backup} from "@aws-sdk/client-backup"
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import {MiddyErrorHandler} from "@PrescriptionStatusUpdate_common/middyErrorHandler"
import {DynamoDBClient, DescribeTableCommand, DescribeTableInput} from "@aws-sdk/client-dynamodb"

const logger = new Logger({serviceName: "psuRestoreValidationLambda"})
const errorResponseBody = {
  message: "There was a problem"
}

const middyErrorHandler = new MiddyErrorHandler(errorResponseBody)

const client = new DynamoDBClient()
const lambdaHandler = async (event) => {
  const sourceTableArn = event.detail.sourceResourceArn
  const createdTableArn = event.detail.createdResourceArn
  logger.debug("Use the following arn for verification", {sourceTableArn, createdTableArn})
  const sourceTableQuery: DescribeTableInput = {
    TableName: sourceTableArn
  }
  const createdTableQuery: DescribeTableInput = {
    TableName: createdTableArn
  }
  // Backup validation result
  const backup = new Backup()
  try {
    const sourceTableResult = await client.send(new DescribeTableCommand(sourceTableQuery))
    const createdTableResult = await client.send(new DescribeTableCommand(createdTableQuery))
    logger.info("Source table info", {sourceTableResult})
    logger.info("Created table info", {createdTableResult})
    const response = await backup.putRestoreValidationResult({
      RestoreJobId: event.detail.restoreJobId,
      ValidationStatus: "SUCCESSFUL",
      ValidationStatusMessage: "Resource validation succeeded"
    })
    logger.info("PutRestoreValidationResult: ", {response})
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
