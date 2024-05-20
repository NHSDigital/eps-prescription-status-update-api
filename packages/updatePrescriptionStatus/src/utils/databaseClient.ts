import {Logger} from "@aws-lambda-powertools/logger"
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactWriteItem,
  TransactWriteItemsCommand
} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"

import {DataItem} from "../updatePrescriptionStatus"
import {Timeout} from "./timeoutUtils"

const logger = new Logger({serviceName: "databaseClient"})
const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"

function createTransactionCommand(dataItems: Array<DataItem>): TransactWriteItemsCommand {
  logger.info("Creating transaction command to write data items.")
  const transactItems: Array<TransactWriteItem> = dataItems.map((d: DataItem): TransactWriteItem => {
    return {
      Put: {
        TableName: tableName,
        Item: marshall(d),
        ConditionExpression: "attribute_not_exists(d.TaskID) AND attribute_not_exists(d.PrescriptionID)"
      }
    }
  })
  return new TransactWriteItemsCommand({TransactItems: transactItems})
}

export async function persistDataItems(dataItems: Array<DataItem>): Promise<boolean | Timeout> {
  const transactionCommand = createTransactionCommand(dataItems)
  try {
    logger.info("Sending TransactWriteItemsCommand to DynamoDB.", {command: transactionCommand})
    await client.send(transactionCommand)
    logger.info("TransactWriteItemsCommand sent to DynamoDB successfully.", {command: transactionCommand})
    return true
  } catch (e) {
    if (e === ConditionalCheckFailedException) {
      logger.error("Duplicate updates were detected during TransactWriteItemsCommand to DynamoDB.", {error: e})
      return false
    } else {
      logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
      return false
    }
  }
}
