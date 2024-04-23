import {DynamoDBDocumentClient, QueryCommand, QueryCommandInput} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import {DynamoDBResult} from "./schema/result.ts"
import {NativeAttributeValue} from "@aws-sdk/util-dynamodb"
import {inputPrescriptionType} from "./schema/request.ts"

const tableName = process.env.TABLE_NAME

export function createDynamoDBQuery(prescription: inputPrescriptionType) {
  const queryParam: QueryCommandInput = {
    TableName: tableName,
    IndexName: "PharmacyODSCodePrescriptionIDIndex",
    KeyConditionExpression: "PrescriptionID = :inputPrescriptionID AND PharmacyODSCode = :inputPharmacyODSCode",
    ExpressionAttributeValues: {
      ":inputPharmacyODSCode": prescription.odsCode,
      ":inputPrescriptionID": prescription.prescriptionID
    }
  }
  return queryParam
}

export async function runDynamoDBQuery(
  query: QueryCommandInput,
  docClient: DynamoDBDocumentClient,
  logger: Logger
): Promise<Array<DynamoDBResult>> {
  // helper function to deal with pagination of results from dynamodb
  const getAllData = async (query: QueryCommandInput) => {
    const _getAllData = async (query: QueryCommandInput, startKey: Record<string, NativeAttributeValue>) => {
      if (startKey) {
        query.ExclusiveStartKey = startKey
      }
      const command = new QueryCommand(query)
      logger.info("running query", {query})
      return docClient.send(command)
    }
    let lastEvaluatedKey = null
    let rows = []
    do {
      const result = await _getAllData(query, lastEvaluatedKey)
      rows = rows.concat(result.Items)
      lastEvaluatedKey = result.LastEvaluatedKey
    } while (lastEvaluatedKey)
    return rows
  }

  const items = await getAllData(query)

  if (items.length !== 0) {
    const response: Array<DynamoDBResult> = items.map((singleUpdate) => {
      const result: DynamoDBResult = {
        prescriptionID: String(singleUpdate.PrescriptionID),
        itemId: String(singleUpdate.LineItemID),
        latestStatus: String(singleUpdate.Status),
        isTerminalState: String(singleUpdate.TerminalStatus),
        lastUpdateDateTime: String(singleUpdate.LastModified)
      }
      return result
    })
    return response
  }
  const result: Array<DynamoDBResult> = []

  return result
}
