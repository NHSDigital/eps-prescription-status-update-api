
import {DynamoDBDocumentClient, QueryCommand, QueryCommandInput} from "@aws-sdk/lib-dynamodb"
import {Logger} from "@aws-lambda-powertools/logger"
import{DynamoDBResult} from "./schema/result.ts"
import {NativeAttributeValue} from "@aws-sdk/util-dynamodb"

export function runDynamoDBQueries (queryParams: Array<QueryCommandInput>,
  docClient: DynamoDBDocumentClient,
  logger: Logger): Array<Promise<Array<DynamoDBResult>>> {

  // helper function to deal with pagination of results from dynamodb
  const getAllData = async (query: QueryCommandInput) => {
    const _getAllData = async (query: QueryCommandInput, startKey: Record<string, NativeAttributeValue>) => {
      if (startKey) {
        query.ExclusiveStartKey = startKey
      }
      const command = new QueryCommand(query)
      logger.info("running query", {query})
      return docClient.send(new QueryCommand(query))
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

  const queryResultsTasks: Array<Promise<Array<DynamoDBResult>>> = queryParams.map(async (query) => {
    // run each query
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
    const result: Array<DynamoDBResult> = [{
      prescriptionID: undefined,
      itemId: undefined,
      latestStatus: undefined,
      isTerminalState: undefined,
      lastUpdateDateTime: undefined
    }]
    return result
  })

  return queryResultsTasks
}
