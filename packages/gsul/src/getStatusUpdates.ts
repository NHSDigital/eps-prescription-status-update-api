
import {Logger} from "@aws-lambda-powertools/logger"
import {injectLambdaContext} from "@aws-lambda-powertools/logger/middleware"
import middy from "@middy/core"
import inputOutputLogger from "@middy/input-output-logger"
import validator from "@middy/validator"
import {transpileSchema} from "@middy/validator/transpile"
import {MiddyErrorHandler} from "@psu-common/middyErrorHandler"
import {getItemsUpdatesForPrescription} from "./dynamoDBclient.ts"
import {requestSchema, requestType, inputPrescriptionType} from "./schema/request.ts"
import {responseType, outputPrescriptionType, itemType} from "./schema/response.ts"

const logger = new Logger({serviceName: "GSUL"})

const errorResponseBody: responseType = {
  schemaVersion: 1,
  isSuccess: false,
  prescriptions: []
}

const middyErrorHandler = new MiddyErrorHandler(errorResponseBody)

const lambdaHandler = async (event: requestType): Promise<responseType> => {
  // there are deliberately no try..catch blocks in this as any errors are caught by custom middy error handler
  // and an error response is sent

  // this is an async map so it returns an array of promises
  const itemResults = event.prescriptions.map(async (prescription) => {
    const queryResult = await getItemsUpdatesForPrescription(prescription.prescriptionID, prescription.odsCode, logger)
    return filterOutFutureReduceToLatestUpdates(prescription, queryResult)
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

export const filterOutFutureReduceToLatestUpdates = (
  inputPrescription: inputPrescriptionType,
  items: Array<itemType>,
  currentTime: number = Date.now() // injectable for testing
): outputPrescriptionType => {

  // filter out items with future lastUpdateDateTime
  const validTimeUpdates = items.filter(item => {
    const updateTime = Date.parse(item.lastUpdateDateTime)
    return updateTime <= currentTime
  })

  // group by itemId and separate post-dated from regular updates
  const itemGroups: Record<string, {regular: itemType | null, postDated: itemType | null}> = {}

  validTimeUpdates.forEach(item => {
    if (!itemGroups[item.itemId]) {
      itemGroups[item.itemId] = {regular: null, postDated: null}
    }
    const group = itemGroups[item.itemId]

    if (item.postDatedLastUpdatedSetAt && !group.postDated) { // this is a post-dated update
      group.postDated = item
    } else if (item.postDatedLastUpdatedSetAt && group.postDated) { // also a post-dated update
      const existingTime = Date.parse(group.postDated.postDatedLastUpdatedSetAt)
      const newTime = Date.parse(item.postDatedLastUpdatedSetAt)
      if (newTime > existingTime) {
        group.postDated = item
      }
    } else if (!group.regular) { // this is a regular update
      group.regular = item
    } else if (group.regular) { // also a regular update
      const existingTime = Date.parse(group.regular.lastUpdateDateTime)
      const newTime = Date.parse(item.lastUpdateDateTime)
      if (newTime > existingTime) {
        group.regular = item
      }
    }
  })

  // flatten both regular and post-dated updates into single array
  const uniqueItems: Array<itemType> = []
  Object.values(itemGroups).forEach(group => {
    if (group.regular) uniqueItems.push(group.regular)
    if (group.postDated) uniqueItems.push(group.postDated)
  })

  const result: outputPrescriptionType = {
    prescriptionID: inputPrescription.prescriptionID,
    onboarded: items.length > 0, // consider onboarded even if all updates were post-dated
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
  .use(middyErrorHandler.errorHandler({logger: logger}))
  .use(
    validator({
      eventSchema: transpileSchema(requestSchema)
    })
  )
