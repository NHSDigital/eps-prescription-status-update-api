import {Logger} from "@aws-lambda-powertools/logger"
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
  QueryCommand,
  QueryCommandInput,
  TransactWriteItem,
  TransactWriteItemsCommand,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb"
import {marshall, unmarshall} from "@aws-sdk/util-dynamodb"

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

export async function checkPrescriptionRecordExistence(
  prescriptionID: string,
  taskID: string,
  logger: Logger
): Promise<boolean> {
  logger.info("Checking if prescription record exists in DynamoDB.", {prescriptionID}, {taskID})
  const query: GetItemCommandInput = {
    TableName: tableName,
    Key: {
      PrescriptionID: {S: prescriptionID},
      TaskID: {S: taskID}
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

export async function getPreviousItem(currentItem: DataItem): Promise<DataItem | undefined> {
  const query: QueryCommandInput = {
    TableName: tableName,
    KeyConditions: {
      PrescriptionID: {
        ComparisonOperator: "EQ",
        AttributeValueList: [marshall(currentItem.PrescriptionID)]
      },
      TaskID: {
        ComparisonOperator: "NE",
        AttributeValueList: [marshall(currentItem.TaskID)]
      }
    },
    QueryFilter: {
      LineItemID: {
        ComparisonOperator: "EQ",
        AttributeValueList: [marshall(currentItem.LineItemID)]
      }
    }
  }

  let lastEvaluatedKey
  let items: Array<DataItem> = []
  do {
    if (lastEvaluatedKey) {
      query.ExclusiveStartKey = lastEvaluatedKey
    }
    const result = await client.send(new QueryCommand(query))
    if (result.Items) {
      items = items.concat(result.Items.map((item) => unmarshall(item) as DataItem))
    }
    lastEvaluatedKey = result.LastEvaluatedKey
  } while (lastEvaluatedKey)

  return items.sort((a, b) => new Date(a.LastModified).valueOf() - new Date(b.LastModified).valueOf()).pop()
}
