import {Logger} from "@aws-lambda-powertools/logger"
import {
  DynamoDBClient,
  TransactWriteItem,
  TransactWriteItemsCommand,
  TransactionCanceledException
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
        ConditionExpression: "attribute_not_exists(TaskID) AND attribute_not_exists(PrescriptionID)",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD"
      }
    }
  })
  return new TransactWriteItemsCommand({TransactItems: transactItems})
}

export async function persistDataItems(dataItems: Array<DataItem>): Promise<boolean | Timeout | string> {
  const transactionCommand = createTransactionCommand(dataItems)
  try {
    logger.info("Sending TransactWriteItemsCommand to DynamoDB.", {command: transactionCommand})
    await client.send(transactionCommand)
    logger.info("TransactWriteItemsCommand sent to DynamoDB successfully.", {command: transactionCommand})
    return true
  } catch (e) {
    if (e instanceof TransactionCanceledException) {
      logger.error("transaction cancelled.", {reasons: e.CancellationReasons})
    }
    logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
    return false
  }
}
