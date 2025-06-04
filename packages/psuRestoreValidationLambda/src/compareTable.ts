
import {Logger} from "@aws-lambda-powertools/logger"
import {
  DynamoDBClient,
  DescribeTableCommand,
  DescribeTableInput,
  ScanCommand,
  ScanCommandInput,
  QueryCommandInput,
  QueryCommand
} from "@aws-sdk/client-dynamodb"
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
  const createdTableDescribe: DescribeTableInput = {
    TableName: restoredTableArn
  }
  const sourceTableScan: ScanCommandInput = {
    TableName: sourceTableArn,
    Limit: 5
  }
  let success = true
  try {
    const sourceTableResult = await client.send(new DescribeTableCommand(sourceTableDescribe))
    const createdTableResult = await client.send(new DescribeTableCommand(createdTableDescribe))
    logger.info("Source table info", {sourceTableResult})
    logger.info("Created table info", {createdTableResult})
    const sourceTableItems = await client.send(new ScanCommand(sourceTableScan))
    if (sourceTableItems === undefined) {
      throw new Error("Can not get results from scan")
    }
    if (sourceTableItems.Items === undefined) {
      throw new Error("Can not get results from scan")
    }
    for (const sourceTableItem of sourceTableItems.Items) {
      const lastModified = new Date(sourceTableItem.LastModified.S as string)
      const yesterday = new Date(new Date().setDate(new Date().getDate()-1))
      if (lastModified > yesterday) {
        logger.info("scanned item is too new", sourceTableItem)
        continue
      }
      const prescriptionID =sourceTableItem.PrescriptionID
      const taskId =sourceTableItem.TaskID
      const restoredTableQueryItem: QueryCommandInput = {
        TableName: restoredTableArn,
        KeyConditionExpression: "PrescriptionID = :inputPrescriptionID  AND TaskID = :inputTaskID",
        ExpressionAttributeValues: {
          ":inputPrescriptionID": prescriptionID,
          ":inputTaskID": taskId
        }
      }
      const createdTableItem = await client.send(new QueryCommand(restoredTableQueryItem))
      if (createdTableItem === undefined) {
        throw new Error("Can not get results from query")
      }
      if (createdTableItem.Items === undefined) {
        throw new Error("Can not get results from query")
      }
      if (createdTableItem.Items.length !== 1) {
        throw new Error("row count on restored table is not 1")
      }
      assert.deepStrictEqual(createdTableItem.Items[0], sourceTableItem)
    }
  } catch(err) {
    logger.error("Error during validation", {error: err})
    success = false
  }
  return success
}
