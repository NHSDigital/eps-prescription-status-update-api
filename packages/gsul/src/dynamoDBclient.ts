import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, QueryCommand, QueryCommandInput} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import {itemType} from "./schema/response.ts"
import {NativeAttributeValue} from "@aws-sdk/util-dynamodb"

const tableName = process.env.TABLE_NAME
const client = new DynamoDBClient()
const docClient = DynamoDBDocumentClient.from(client)

export async function getItemsUpdatesForPrescription(
  prescriptionID: string,
  odsCode: string,
  logger: Logger
): Promise<Array<itemType>> {
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

  const queryCommandInput = createQueryCommandInput(odsCode, prescriptionID)
  const items = await getAllData(queryCommandInput)

  return items.map((singleUpdate) => ({
    itemId: String(singleUpdate.LineItemID),
    latestStatus: String(singleUpdate.Status),
    isTerminalState: Boolean(singleUpdate.TerminalStatus),
    lastUpdateDateTime: String(singleUpdate.LastModified)
  }))
}

export function createQueryCommandInput(odsCode: string, prescriptionID: string): QueryCommandInput {
  return {
    TableName: tableName,
    IndexName: "PharmacyODSCodePrescriptionIDIndex",
    KeyConditionExpression: "PrescriptionID = :inputPrescriptionID AND PharmacyODSCode = :inputPharmacyODSCode",
    ExpressionAttributeValues: {
      ":inputPharmacyODSCode": odsCode.toUpperCase(),
      ":inputPrescriptionID": prescriptionID.toUpperCase()
    }
  }
}
