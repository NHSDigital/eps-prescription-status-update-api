/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import {DynamoDBClient} from "@aws-sdk/client-dynamodb"
import {DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {errorHandler} from "./errorHandler.ts"
import {createDynamoDBQuery, runDynamoDBQuery} from "./dynamoDBclient.ts"
import {requestSchema, requestType, inputPrescriptionType} from "./schema/request.ts"
import {responseType, outputPrescriptionType, itemType} from "./schema/response.ts"
import {DynamoDBResult} from "./schema/result.ts"

const logger = new Logger({serviceName: "GSUL"})
const client = new DynamoDBClient({region: "eu-west-2"})
const docClient = DynamoDBDocumentClient.from(client)

const lambdaHandler = async (event: requestType): Promise<responseType> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

  // this is an async map so it returns an array of promises
  const itemResults = event.prescriptions.map(async (prescription) => {
    const query = createDynamoDBQuery(prescription)
    const queryResult = await runDynamoDBQuery(query, docClient, logger)
    const result = buildResult(prescription, queryResult)
    return result
  })

  // wait for all the promises to complete
  const finalResults = await Promise.all(itemResults)
  const response = {
    schemaVersion: 1,
    isSuccess: true,
    prescriptions: finalResults
  }
  return response
}

export const buildResult = (
  inputPrescription: inputPrescriptionType,
  items: Array<DynamoDBResult>
): outputPrescriptionType => {
  // if we have results then populate the response
  if (items.length > 0) {
    // we need to get the latest update per item id
    // first get the unique item ids
    const uniqueItemIds = [
      ...new Set(
        items.map((item) => {
          return item.itemId
        })
      )
    ]

    // now get an array of the latest updates for each unique item id
    const latestUpdates = uniqueItemIds.map((itemId) => {
      // get all the updates for this item id
      const matchedItems = items.filter((item) => {
        return item.itemId === itemId
      })

      // now just get the latest update
      const latestUpdate = matchedItems.reduce((prev, current) => {
        return prev && Date.parse(prev.lastUpdateDateTime) > Date.parse(current.lastUpdateDateTime) ? prev : current
      })

      return latestUpdate
    })

    const responseItems = latestUpdates.map((item) => {
      const returnItem: itemType = {
        itemId: String(item.itemId),
        latestStatus: String(item.latestStatus),
        isTerminalState: String(item.isTerminalState),
        lastUpdateDateTime: String(item.lastUpdateDateTime)
      }
      return returnItem
    })
    const result: outputPrescriptionType = {
      prescriptionID: inputPrescription.prescriptionID,
      onboarded: true,
      items: responseItems
    }
    return result
  }
  // we have no results returned so return an empty array of items
  const result = {
    prescriptionID: inputPrescription.prescriptionID,
    onboarded: false,
    items: []
  }
  return result
}

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, {clearState: true}))
  .use(
    inputOutputLogger({
      logger: (request) => {
        if (request.response) {
          logger.info(request.response)
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
