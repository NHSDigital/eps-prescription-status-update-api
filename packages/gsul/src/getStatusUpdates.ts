/* eslint-disable @typescript-eslint/no-explicit-any */
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {errorHandler} from "./errorHandler.ts"
import {requestSchema, inputPrescriptionType} from "./schema/request.ts"
import {responseType, outputPrescriptionType, itemType} from "./schema/response.ts"

const logger = new Logger({serviceName: "GSUL"})

const lambdaHandler = async (): Promise<responseType> => {
  await new Promise((f) => setTimeout(f, 10000))
  const response = {
    schemaVersion: 1,
    isSuccess: true,
    prescriptions: []
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
      if (!r[e.itemId] || Date.parse(e.lastUpdateDateTime) > Date.parse(r[e.itemId].lastUpdateDateTime)) r[e.itemId] = e
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
