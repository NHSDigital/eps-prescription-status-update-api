import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput
} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"

const tableName = process.env.TABLE_NAME
const client = new DynamoDBClient()
const docClient = DynamoDBDocumentClient.from(client)

type buildQueryResult = {
  isScanQuery: boolean
  query: QueryCommandInput | ScanCommandInput
}

export function buildQuery(
  prescriptionID: string | undefined,
  applicationName: string | undefined,
  odsCode: string | undefined,
  nhsNumber: string | undefined,
  showAllSuppliers: string | undefined,
  overrideApplicationName: string | undefined,
  exclusiveStartKeyPrescriptionID: string | undefined,
  exclusiveStartKeyTaskID: string | undefined
): buildQueryResult {
  const expressionAttributeValues = {}
  const filterExpressions: Array<string> = []

  let applicationNameToUse = applicationName
  if (showAllSuppliers === "true") {
    applicationNameToUse = overrideApplicationName
  }
  if (typeof applicationNameToUse !== "undefined" && applicationNameToUse) {
    filterExpressions.push("ApplicationName = :ApplicationName")
    expressionAttributeValues[":ApplicationName"] = applicationNameToUse
  }
  if (typeof odsCode !== "undefined" && odsCode) {
    filterExpressions.push("PharmacyODSCode = :PharmacyODSCode")
    expressionAttributeValues[":PharmacyODSCode"] = odsCode
  }
  if (typeof nhsNumber !== "undefined" && nhsNumber) {
    filterExpressions.push("PatientNHSNumber = :PatientNHSNumber")
    expressionAttributeValues[":PatientNHSNumber"] = nhsNumber
  }

  const query: QueryCommandInput | ScanCommandInput = {
    TableName: tableName,
    Limit: 10
  }

  if (typeof exclusiveStartKeyPrescriptionID !== "undefined" && typeof exclusiveStartKeyTaskID !== "undefined") {
    query.ExclusiveStartKey = {
      PrescriptionID: exclusiveStartKeyPrescriptionID,
      TaskID: exclusiveStartKeyTaskID
    }
  }
  if (filterExpressions.length > 0) {
    query.FilterExpression = filterExpressions.join(" AND ")
  }

  if (typeof prescriptionID !== "undefined" && prescriptionID) {
    const queryToRun = query as QueryCommandInput
    queryToRun.KeyConditionExpression = "PrescriptionID = :inputPrescriptionID"
    expressionAttributeValues[":inputPrescriptionID"] = prescriptionID
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

export async function getItemStatusUpdates(
  prescriptionID: string | undefined,
  applicationName: string | undefined,
  odsCode: string | undefined,
  nhsNumber: string | undefined,
  showAllSuppliers: string | undefined,
  overrideApplicationName: string | undefined,
  exclusiveStartKeyPrescriptionID: string | undefined,
  exclusiveStartKeyTaskID: string | undefined,
  logger: Logger
) {
  const result = buildQuery(
    prescriptionID,
    applicationName,
    odsCode,
    nhsNumber,
    showAllSuppliers,
    overrideApplicationName,
    exclusiveStartKeyPrescriptionID,
    exclusiveStartKeyTaskID
  )

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
