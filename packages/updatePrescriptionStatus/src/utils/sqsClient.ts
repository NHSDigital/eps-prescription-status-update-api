import {Logger} from "@aws-lambda-powertools/logger"
import {DataItem} from "../updatePrescriptionStatus"

const sqsUrl = process.env.NHS_NOTIFY_PRESCRIPTIONS_SQS_QUEUE_URL

export function pushPrescriptionToNotificationSQS(data: Array<DataItem>, logger: Logger) {
  logger.info("Pushing data items up to the notifications SQS", {data, sqsUrl})
}
