import {Logger} from "@aws-lambda-powertools/logger"
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
  QueryCommand,
  QueryCommandInput,
  TransactionCanceledException,
  TransactWriteItem,
  TransactWriteItemsCommand
} from "@aws-sdk/client-dynamodb"
import {marshall, unmarshall} from "@aws-sdk/util-dynamodb"

import {PSUDataItem} from "@PrescriptionStatusUpdate_common/commonTypes"
import {Timeout} from "./timeoutUtils"

const client = new DynamoDBClient()
const tableName = process.env.TABLE_NAME ?? "PrescriptionStatusUpdates"

function createTransactionCommand(dataItems: Array<PSUDataItem>, logger: Logger): TransactWriteItemsCommand {
  logger.info("Creating transaction command to write data items.")
  const transactItems: Array<TransactWriteItem> = dataItems.map((d: PSUDataItem): TransactWriteItem => {
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

export async function persistDataItems(dataItems: Array<PSUDataItem>, logger: Logger): Promise<boolean | Timeout> {
  // break the array of data items into batches less than 100
  // to prevent dynamodb error with too many items
  const chunkSize = 99
  const transactionCommands = []
  for (let i = 0; i < dataItems.length; i += chunkSize) {
    const chunk = dataItems.slice(i, i + chunkSize)
    const transactionCommand = createTransactionCommand(chunk, logger)
    transactionCommands.push(transactionCommand)
  }
  const results = await Promise.all(transactionCommands.map(async transactionCommand => {
    try {
      logger.info("Sending TransactWriteItemsCommand to DynamoDB.", {command: transactionCommand})
      await client.send(transactionCommand)
      logger.info("TransactWriteItemsCommand sent to DynamoDB successfully.", {command: transactionCommand})
      return {success: true}
    } catch (e) {
      if (e instanceof TransactionCanceledException) {
        logger.error(
          "DynamoDB transaction cancelled due to conditional check failure.", {reasons: e.CancellationReasons})
        return {success: false, errorMessage: "conditional check failure", error: e}
      } else {
        logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
      }
      return {success: false, errorMessage: "other error", error: e}
    }
  }))
  const failed = results.filter(r => !r.success)
  if (failed.length > 0) {
    const conditionalCheckFailures = failed.filter(r=> r.errorMessage === "conditional check failure")
    if (conditionalCheckFailures.length > 0) {
      throw(conditionalCheckFailures[0].error)
    }
    return false
  } else {
    return true
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

export async function getPreviousItem(currentItem: PSUDataItem): Promise<PSUDataItem | undefined> {
  const query: QueryCommandInput = {
    TableName: tableName,
    KeyConditions: {
      PrescriptionID: {
        ComparisonOperator: "EQ",
        AttributeValueList: [marshall(currentItem.PrescriptionID)]
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
  let items: Array<PSUDataItem> = []
  do {
    if (lastEvaluatedKey) {
      query.ExclusiveStartKey = lastEvaluatedKey
    }
    const result = await client.send(new QueryCommand(query))
    if (result.Items) {
      items = items.concat(
        result.Items
          .map((item) => unmarshall(item) as PSUDataItem)
          .filter((item) => item.TaskID !== currentItem.TaskID) // Can't do NE in the query so filter here
      )
    }
    lastEvaluatedKey = result.LastEvaluatedKey
  } while (lastEvaluatedKey)

  items.sort((a, b) => new Date(a.LastModified).valueOf() - new Date(b.LastModified).valueOf())
  return items.pop()
}
