import {Logger} from "@aws-lambda-powertools/logger"
import {Validator} from "../../handler"
import {eventType, requestType} from "./request"
import {Err, Ok} from "pratica"
import {wrap_with_status} from "../../utils"

/**
 *  Ignores messages that are not of type "PrescriptionStatusChanged"
 *  and returns a 202 status code with a message "Message Ignored"
 */
export const validator: Validator<eventType, requestType> = (event, logger: Logger) => {
  const requestBody = event.body

  if (requestBody.MessageType !== "PrescriptionStatusChanged") {
    logger.warn(`Message of type '${requestBody.MessageType}' Ignored`)
    return Err(wrap_with_status(202, {})("Message Ignored"))
  }

  return Ok(requestBody)
}
