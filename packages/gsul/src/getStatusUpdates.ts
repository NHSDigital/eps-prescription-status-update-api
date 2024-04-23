/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {errorHandler} from "./errorHandler.ts"
import {getItemsUpdatesForPrescription} from "./dynamoDBclient.ts"
import {requestSchema, requestType, inputPrescriptionType} from "./schema/request.ts"
import {responseType, outputPrescriptionType, itemType} from "./schema/response.ts"

const logger = new Logger({serviceName: "GSUL"})

const lambdaHandler = async (event: requestType): Promise<responseType> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

  // this is an async map so it returns an array of promises
  const itemResults = event.prescriptions.map(async (prescription) => {
    const queryResult = await getItemsUpdatesForPrescription(prescription.prescriptionID, prescription.odsCode, logger)
    return buildResult(prescription, queryResult)
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
  items: Array<itemType>
): outputPrescriptionType => {
  // get unique item ids with the latest update based on lastUpdateDateTime
  const uniqueItems: Array<itemType> = Object.values(
    items.reduce(function (r, e) {
      if (!r[e.itemId]) r[e.itemId] = e
      else if (Date.parse(e.lastUpdateDateTime) > Date.parse(r[e.itemId].lastUpdateDateTime)) r[e.itemId] = e
      return r
    }, {})
  )

  const result: outputPrescriptionType = {
    prescriptionID: inputPrescription.prescriptionID,
    onboarded: items.length > 0,
    items: uniqueItems
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
