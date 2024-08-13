import {Logger} from "@aws-lambda-powertools/logger"
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
  TransactWriteItem,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb"
import {marshall} from "@aws-sdk/util-dynamodb"

import {DataItem} from "../updatePrescriptionStatus"
import {Timeout} from "./timeoutUtils"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"

function createTransactionCommand(dataItems: Array<DataItem>, logger: Logger): TransactWriteItemsCommand {
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

export async function persistDataItems(dataItems: Array<DataItem>, logger: Logger): Promise<boolean | Timeout> {
  const transactionCommand = createTransactionCommand(dataItems, logger)
  try {
    logger.info("Sending TransactWriteItemsCommand to DynamoDB.", {command: transactionCommand})
    await client.send(transactionCommand)
    logger.info("TransactWriteItemsCommand sent to DynamoDB successfully.", {command: transactionCommand})
    return true
  } catch (e) {
    if (e instanceof TransactionCanceledException) {
      logger.error("DynamoDB transaction cancelled due to conditional check failure.", {reasons: e.CancellationReasons})
      throw e
    }
    logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
    return false
  }
}

export async function checkPrescriptionRecordExistence(prescriptionID: string, logger: Logger): Promise<boolean> {
  logger.info("Checking if prescription record exists in DynamoDB.", {prescriptionID})
  const query: GetItemCommandInput = {
    TableName: tableName,
    Key: {
      PrescriptionID: {S: prescriptionID}
    }
  }
  try {
    const result = await client.send(new GetItemCommand(query))
    logger.info("Query successful.", {result})
    return !!result?.Item
  } catch (e) {
    logger.error("Error querying DynamoDB.", {error: e})
    return false
  }
}
