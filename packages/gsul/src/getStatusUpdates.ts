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
  // store an empty map of itemId to latest update
  const uniqueItemMap: Map<string, itemType> = new Map()

  for (const item of items) {
    // if the itemId hasn't been seen store the update
    if (!uniqueItemMap.has(item.itemId)) {
      uniqueItemMap.set(item.itemId, item)
    } else {
      // if the existing update is older overwrite it
      const prev = uniqueItemMap.get(item.itemId)
      if (Date.parse(prev.lastUpdateDateTime) < Date.parse(item.lastUpdateDateTime)) {
        uniqueItemMap.set(item.itemId, item)
      }
    }
  }

  const result: outputPrescriptionType = {
    prescriptionID: inputPrescription.prescriptionID,
    onboarded: items.length > 0,
    items: [...uniqueItemMap.values()]
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
