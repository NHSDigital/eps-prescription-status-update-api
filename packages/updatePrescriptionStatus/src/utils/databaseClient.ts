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

import {
  PSUDataItem,
  PSUDataItemWithPrevious,
  TestReportLogMessagePayload
} from "@PrescriptionStatusUpdate_common/commonTypes"
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

function logDatabaseCollisionForTestReport(logger: Logger, transactionCommand: TransactWriteItemsCommand) {
  // Don't log this in prod
  const isEnabled = process.env["ENABLE_TEST_REPORT_LOGS"]?.toLowerCase().trim() === "true"
  if (!isEnabled) return

  // This is pretty ugly, but needed to pull the PSU data item back out of the transaction command.
  const recoveredItems = transactionCommand.input
    .TransactItems
    ?.map(item => item.Put?.Item)
    .filter((i) => i !== undefined)
    .map(item => unmarshall(item) as PSUDataItem) ?? []

  recoveredItems.forEach(i => {
    logger.info(
      "[AEA-4318] - Dynamo condition check failure; TaskID and PrescriptionID collide with previous record",
      {
        prescriptionID: i.PrescriptionID,
        lineItemID: i.LineItemID,
        appName: i.ApplicationName,
        taskID: i.TaskID,
        currentStatus: i.Status,
        currentTerminalStatus: i.TerminalStatus,
        currentTimestamp: i.LastModified
      } satisfies TestReportLogMessagePayload
    )
  })
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
        logDatabaseCollisionForTestReport(logger, transactionCommand)

        return {success: false, errorMessage: "conditional check failure", error: e}
      } else {
        // This will usually be caused by the throughput exceeding the provisioned level.
        logger.error("Error sending TransactWriteItemsCommand to DynamoDB.", {error: e})
      }
      return {success: false, errorMessage: "other error", error: e}
    }
  }))
  const failed = results.filter(r => !r.success)
  if (failed.length > 0) {
    const conditionalCheckFailures = failed.filter(r => r.errorMessage === "conditional check failure")
    if (conditionalCheckFailures.length > 0) {
      throw (conditionalCheckFailures[0].error)
    }
    return false
  } else {
    return true
  }
}

/**
 * Restore table to its state before a persistDataItems() call by deleting the
 * items that call inserted. We only delete when RequestID matches, so we
 * don't clobber newer versions written under the same TaskID.
 *
 * Returns:
 *  - true  = all deletes either succeeded or were safely skipped
 *                    (because RequestID didn't match or item absent)
 *  - false = at least one delete failed with an unexpected error
 */
export async function rollbackDataItems(
  dataItems: Array<PSUDataItem>,
  logger: Logger
): Promise<boolean> {
  logger.info("Restoring table to pre-persist state based on RequestID match.")

  const deleteTxnFor = (item: PSUDataItem): TransactWriteItemsCommand => {
    const deleteOp: TransactWriteItem = {
      Delete: {
        TableName: tableName,
        Key: marshall({PrescriptionID: item.PrescriptionID, TaskID: item.TaskID}),
        // Only delete if the current item's RequestID equals the one we inserted.
        // Since the TaskID might appear more than once, can't use that.
        // We only care about this request's items anyway.
        ConditionExpression:
          "attribute_exists(PrescriptionID) AND attribute_exists(TaskID) AND #rid = :rid",
        ExpressionAttributeNames: {"#rid": "RequestID"},
        ExpressionAttributeValues: {":rid": {S: item.RequestID}},
        ReturnValuesOnConditionCheckFailure: "ALL_OLD"
      }
    }
    return new TransactWriteItemsCommand({TransactItems: [deleteOp]})
  }

  const results = await Promise.all(
    dataItems.map(async (item) => {
      const cmd = deleteTxnFor(item)
      try {
        logger.info("Attempting conditioned delete (by RequestID).", {
          PrescriptionID: item.PrescriptionID,
          TaskID: item.TaskID,
          RequestID: item.RequestID
        })
        await client.send(cmd)
        logger.info("Delete succeeded.", {
          PrescriptionID: item.PrescriptionID,
          TaskID: item.TaskID
        })
        return {success: true as const}
      } catch (e) {
        if (e instanceof TransactionCanceledException) {
          logger.warn("Rollback skipped due to RequestID mismatch or missing item.", {
            PrescriptionID: item.PrescriptionID,
            TaskID: item.TaskID,
            RequestID: item.RequestID,
            reasons: e.CancellationReasons
          })
          return {success: true as const, skipped: true}
        }
        logger.error("Unexpected error during rollback.", {
          PrescriptionID: item.PrescriptionID,
          TaskID: item.TaskID,
          RequestID: item.RequestID,
          error: e
        })
        return {success: false as const}
      }
    })
  )

  return results.every(r => r.success)
}

/**
 * This is run as part of the AEA-4317 (AEA-4365) - Intercept INT test prescriptions case.
 * It is not executed in prod
 */
export async function checkPrescriptionRecordExistence(
  dataItem: PSUDataItem,
  logger: Logger
): Promise<boolean> {
  logger.info(
    "Checking if prescription record exists in DynamoDB.",
    {prescriptionID: dataItem.PrescriptionID},
    {taskID: dataItem.TaskID}
  )
  const query: GetItemCommandInput = {
    TableName: tableName,
    Key: {
      PrescriptionID: {S: dataItem.PrescriptionID},
      TaskID: {S: dataItem.TaskID}
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

function logPreviousItemNotFountForTestReport(logger: Logger, currentItem: PSUDataItem) {
  // Don't log this in prod
  const isEnabled = process.env["ENABLE_TEST_REPORT_LOGS"]?.toLowerCase().trim() === "true"
  if (!isEnabled) return

  logger.info(
    "[AEA-4318] - No prior statuses in the data store (or the only record uses the same task ID as this update)",
    {
      prescriptionID: currentItem.PrescriptionID,
      lineItemID: currentItem.LineItemID,
      taskID: currentItem.TaskID,
      appName: currentItem.ApplicationName,
      currentStatus: currentItem.Status,
      currentTerminalStatus: currentItem.TerminalStatus,
      currentTimestamp: currentItem.LastModified
    } satisfies TestReportLogMessagePayload
  )
}

export async function getPreviousItem(currentItem: PSUDataItem, logger: Logger): Promise<PSUDataItemWithPrevious> {
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
  // this is in a try catch block so that it always return something, even if there is an error
  // so that the promise map where it is called does not error
  try {
    do {
      if (lastEvaluatedKey) {
        query.ExclusiveStartKey = lastEvaluatedKey
      }
      const result = await client.send(new QueryCommand(query))

      if (!result || !result.Items) break

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
    const mostRecentItem = items.pop()

    if (!mostRecentItem) logPreviousItemNotFountForTestReport(logger, currentItem)

    return {
      current: currentItem,
      previous: mostRecentItem
    }
  } catch (err) {
    logger.error("Error retrieving previous item status", {error: err})
    return {
      current: currentItem,
      previous: undefined
    }
  }
}
