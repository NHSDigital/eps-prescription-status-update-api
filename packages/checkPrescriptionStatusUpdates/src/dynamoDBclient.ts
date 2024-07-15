import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput
} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import {InputData} from "./types"

const tableName = process.env.TABLE_NAME
const client = new DynamoDBClient()
const docClient = DynamoDBDocumentClient.from(client)

type buildQueryResult = {
  isScanQuery: boolean
  query: QueryCommandInput | ScanCommandInput
}

export function buildQuery(inputData: InputData): buildQueryResult {
  const expressionAttributeValues = {}
  const filterExpressions: Array<string> = []

  let applicationNameToUse = inputData.applicationName
  if (inputData.showAllSuppliers === "true") {
    applicationNameToUse = inputData.overrideApplicationName
  }
  if (typeof applicationNameToUse !== "undefined" && applicationNameToUse) {
    filterExpressions.push("ApplicationName = :ApplicationName")
    expressionAttributeValues[":ApplicationName"] = applicationNameToUse
  }
  if (typeof inputData.odsCode !== "undefined" && inputData.odsCode) {
    filterExpressions.push("PharmacyODSCode = :PharmacyODSCode")
    expressionAttributeValues[":PharmacyODSCode"] = inputData.odsCode
  }
  if (typeof inputData.nhsNumber !== "undefined" && inputData.nhsNumber) {
    filterExpressions.push("PatientNHSNumber = :PatientNHSNumber")
    expressionAttributeValues[":PatientNHSNumber"] = inputData.nhsNumber
  }

  const query: QueryCommandInput | ScanCommandInput = {
    TableName: tableName,
    Limit: inputData.maxResults || 15
  }

  if (
    typeof inputData.exclusiveStartKeyPrescriptionID !== "undefined" &&
    typeof inputData.exclusiveStartKeyTaskID !== "undefined"
  ) {
    query.ExclusiveStartKey = {
      PrescriptionID: inputData.exclusiveStartKeyPrescriptionID,
      TaskID: inputData.exclusiveStartKeyTaskID
    }
  }
  if (filterExpressions.length > 0) {
    query.FilterExpression = filterExpressions.join(" AND ")
  }

  if (typeof inputData.prescriptionID !== "undefined" && inputData.prescriptionID) {
    const queryToRun = query as QueryCommandInput
    queryToRun.KeyConditionExpression = "PrescriptionID = :inputPrescriptionID"
    expressionAttributeValues[":inputPrescriptionID"] = inputData.prescriptionID
    queryToRun.ExpressionAttributeValues = expressionAttributeValues

    return {
      isScanQuery: false,
      query: queryToRun
    }
  } else {
    if (Object.keys(expressionAttributeValues).length > 0) {
      query.ExpressionAttributeValues = expressionAttributeValues
    }
    return {
      isScanQuery: true,
      query
    }
  }
}

export async function getItemStatusUpdates(inputData: InputData, logger: Logger) {
  const result = buildQuery(inputData)

  if (result.isScanQuery) {
    const command = new ScanCommand(result.query)
    logger.info("running scan query", {query: result.query})
    return await docClient.send(command)
  } else {
    const command = new QueryCommand(result.query)
    logger.info("running query", {query: result.query})
    return await docClient.send(command)
  }
}
