/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient, QueryCommandInput} from "@aws-sdk/lib-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {errorHandler} from "./errorHandler.ts"
import {runDynamoDBQueries} from "./dynamoDBclient.ts"
import {requestSchema, requestType, inputPrescriptionType} from "./schema/request.ts"
import {responseType, outputPrescriptionType, itemType} from "./schema/response.ts"
import {DynamoDBResult} from "./schema/result.ts"

const logger = new Logger({serviceName: "GSUL"})
const client = new DynamoDBClient({region: "eu-west-2"})
const docClient = DynamoDBDocumentClient.from(client)
const tableName = process.env.TABLE_NAME

const lambdaHandler = async (event: requestType): Promise<responseType> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

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
  const queryResultsTasks = runDynamoDBQueries(queryParams, docClient, logger)

  // get all the query results
  const queryResults = await Promise.all(queryResultsTasks)

  const itemResults = buildResults(event.prescriptions, queryResults.flat())

  const response = {
    "schemaVersion": 1,
    "isSuccess": true,
    "prescriptions": itemResults
  }
  return response
}

export const buildResults = (inputPrescriptions: Array<inputPrescriptionType>,
  queryResults: Array<DynamoDBResult>): Array<outputPrescriptionType> => {
  // for each prescription id passed in build up a response
  const itemResults = inputPrescriptions.map((prescription) => {
    const items = queryResults.filter((queryResult) => {
      // see if we have any results for the prescription id
      return queryResult?.prescriptionID === prescription.prescriptionID
    })
    // if we have results then populate the response
    if (items.length > 0) {
      // get the latest update per item id

      // first get the unique item ids
      const uniqueItemIds = [...new Set(items.map((item) => {
        return item.itemId
      }))]

      // now get an array of the latest updates for each unique item id
      const latestUpdates = uniqueItemIds.map((itemId)=> {

        // get all the updates for this prescription id and item id
        const matchedItems = items.filter((item) => {
          return item.prescriptionID === prescription.prescriptionID && item.itemId === itemId
        })

        // now just get the latest update
        const latestUpdate = matchedItems.reduce((prev, current) => {
          return (prev && Date.parse(prev.lastUpdateDateTime) > Date.parse(current.lastUpdateDateTime)) ? prev : current
        })

        return latestUpdate
      })

      const responseItems = latestUpdates.map((item) => {
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
