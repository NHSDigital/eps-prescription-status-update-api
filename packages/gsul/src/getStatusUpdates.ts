/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, QueryCommand, QueryCommandInput} from "@aws-sdk/lib-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {errorHandler} from "./errorHandler.ts"
import{requestSchema, requestType, inputPrescriptionType} from "./schema/request.ts"
import{responseType, outputPrescriptionType, itemType} from "./schema/response.ts"
const logger = new Logger({serviceName: "updatePrescriptionStatus"})
const client = new DynamoDBClient({region: "eu-west-2"})
const docClient = DynamoDBDocumentClient.from(client)
const tableName = process.env.TABLE_NAME

interface DynamoDBResult {
  prescriptionID: string | undefined;
  itemId: string | undefined;
  latestStatus: string | undefined;
  isTerminalState: string | undefined;
  lastUpdateDateTime: string | undefined
}

const lambdaHandler = async (event: requestType): Promise<responseType> => {

  const queryParams = event.prescriptions.map((prescription) => {
    // create query for each prescription and ods code passed in
    const queryParam : QueryCommandInput = {
      TableName: tableName,
      IndexName: "PrescriptionIDIndex",
      KeyConditionExpression: "PrescriptionID = :inputPrescriptionID AND PharmacyODSCode = :inputPharmacyODSCode",
      ExpressionAttributeValues: {
        ":inputPharmacyODSCode": prescription.odsCode,
        ":inputPrescriptionID": prescription.prescriptionID
      }
    }
    return queryParam
  })

  // run the dynamodb queries
  const queryResultsTasks = await runDynamoDBQueries(queryParams)

  // get all the query results
  const queryResults = await Promise.all(queryResultsTasks)

  const itemResults = buildResults(event.prescriptions, queryResults)

  const response = {
    "schemaVersion": 1,
    "isSuccess": true,
    "prescriptions": itemResults
  }
  return response
}

const runDynamoDBQueries = (queryParams: Array<QueryCommandInput>): Array<Promise<DynamoDBResult>> => {
  const queryResultsTasks: Array<Promise<DynamoDBResult>> = queryParams.map(async (query) => {
    // run each query
    const command = new QueryCommand(query)
    logger.info("running query", {query})
    const dynamoDBresponse = await docClient.send(command)
    if (dynamoDBresponse?.Count !== 0) {
      // if we have a response get the latest update
      const latestUpdate = dynamoDBresponse.Items?.reduce((prev, current) => {
        return (prev && Date.parse(prev.LastModified) > Date.parse(current.LastModified)) ? prev : current
      })

      const result: DynamoDBResult = {
        prescriptionID: String(latestUpdate?.PrescriptionID),
        itemId: String(latestUpdate?.LineItemID),
        latestStatus: String(latestUpdate?.Status),
        isTerminalState: String(latestUpdate?.TerminalStatus),
        lastUpdateDateTime: String(latestUpdate?.LastModified)
      }
      return Promise.resolve(result)
    }
    const result: DynamoDBResult = {
      prescriptionID: undefined,
      itemId: undefined,
      latestStatus: undefined,
      isTerminalState: undefined,
      lastUpdateDateTime: undefined
    }
    return Promise.resolve(result)
  })

  return queryResultsTasks
}

const buildResults = (inputPrescriptions: Array<inputPrescriptionType>,
  queryResults: Array<DynamoDBResult>): Array<outputPrescriptionType> => {
  // for each prescription id passed in build up a response
  const itemResults = inputPrescriptions.map((prescription) => {
    const items = queryResults.filter((queryResult) => {
      // see if we have any results for the prescription id
      return queryResult?.prescriptionID === prescription.prescriptionID
    })
    // if we have results then populate the response
    if (items.length > 0) {
      const responseItems = items.map((item) => {
        const returnItem: itemType = {
          "itemId": String(item.itemId),
          "latestStatus": String(item.latestStatus),
          "isTerminalState": String(item.isTerminalState),
          "lastUpdateDateTime": String(item.lastUpdateDateTime)
        }
        return returnItem
      })
      const result: outputPrescriptionType = {
        "prescriptionID": prescription.prescriptionID,
        "onboarded": true,
        "items": responseItems
      }
      return result
    }
    // we have no results returned so return an empty array of items
    const result = {
      "prescriptionID": prescription.prescriptionID,
      "onboarded": true,
      "items": []
    }
    return result
  })
  return itemResults
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        if (request.response) {
          logger.info(request)
        } else {
          logger.info(request)
        }
      }
    })
  )
  .use(errorHandler({logger: logger}))
  .use(
    validator({
      eventSchema: transpileSchema(requestSchema)
    })
  )
