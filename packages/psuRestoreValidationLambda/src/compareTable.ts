
import {Logger} from "@aws-lambda-powertools/logger"
import {DescribeTableCommand, DescribeTableInput, DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {
  ScanCommand,
  ScanCommandInput,
  QueryCommandInput,
  QueryCommand
} from "@aws-sdk/lib-dynamodb"
import assert from "assert"

export const compareTables = async(
  sourceTableArn: string,
  restoredTableArn: string,
  client: DynamoDBClient,
  logger: Logger
) => {
  const sourceTableDescribe: DescribeTableInput = {
    TableName: sourceTableArn
  }
  const restoredTableDescribe: DescribeTableInput = {
    TableName: restoredTableArn
  }
  const sourceTableScan: ScanCommandInput = {
    TableName: sourceTableArn,
    Limit: 5
  }
  let success = true
  try {
    const sourceTableResult = await client.send(new DescribeTableCommand(sourceTableDescribe))
    const restoredTableResult = await client.send(new DescribeTableCommand(restoredTableDescribe))
    logger.info("Source table describe table result", {sourceTableResult})
    logger.info("Restored table describe table result", {restoredTableResult})
    const sourceTableItems = await client.send(new ScanCommand(sourceTableScan))
    if (sourceTableItems === undefined) {
      logger.error("sourceTableItems is undefined", {sourceTableScan})
      throw new Error("Can not get results from scan")
    }
    if (sourceTableItems.Items === undefined) {
      logger.error("sourceTableItems.Items is undefined", {sourceTableScan, sourceTableItems})
      throw new Error("Can not get results from scan")
    }
    for (const sourceTableItem of sourceTableItems.Items) {
      const lastModified = new Date(sourceTableItem.LastModified.S as string)
      const yesterday = new Date(new Date().setDate(new Date().getDate()-1))
      if (lastModified > yesterday) {
        logger.info("scanned item is too new", {sourceTableItem})
        continue
      }
      const prescriptionID = String(sourceTableItem.PrescriptionID)
      const taskId = String(sourceTableItem.TaskID)
      logger.debug("Querying restored table", {queryParameters: {prescriptionID, taskId}})
      const restoredTableQuery: QueryCommandInput = {
        TableName: restoredTableArn,
        KeyConditionExpression: "PrescriptionID = :inputPrescriptionID  AND TaskID = :inputTaskID",
        ExpressionAttributeValues: {
          ":inputPrescriptionID": prescriptionID,
          ":inputTaskID": taskId
        }
      }
      const restoredTableItemResult = await client.send(new QueryCommand(restoredTableQuery))
      if (restoredTableItemResult === undefined) {
        logger.error("restoredTableItem is undefined", {queryParameters: {prescriptionID, taskId}, restoredTableQuery})
        throw new Error("Can not get results from query")
      }
      if (restoredTableItemResult.Items === undefined) {
        logger.error("createdTableItem.Items is undefined",
          {queryParameters: {prescriptionID, taskId}, restoredTableQuery, restoredTableItemResult})
        throw new Error("Can not get results from query")
      }
      if (restoredTableItemResult.Items.length !== 1) {
        logger.error("Restored table count is not 1",
          {queryParameters: {prescriptionID, taskId}, restoredTableQuery, restoredTableItemResult})
        throw new Error("Row count on restored table query is not 1")
      }
      const restoredTableItem = restoredTableItemResult.Items[0]
      logger.debug("Comparing these two items", {compare: {restoredTableItem, sourceTableItem}})
      assert.deepStrictEqual(restoredTableItem, sourceTableItem)
    }
  } catch(err) {
    logger.error("Error during validation", {error: err})
    success = false
  }
  return success
}
