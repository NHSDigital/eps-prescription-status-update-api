import {Validator} from "../../handler"
import {eventType, requestType} from "./request"
import {Err, Ok} from "pratica"

/**
 *  Ignores messages that are not of type "PrescriptionStatusChanged"
 *  and returns a 202 status code with a message "Message Ignored"
 */
export const validator: Validator<eventType, requestType> = (event) => {
  const requestBody = event.body

  if (requestBody.MessageType !== "PrescriptionStatusChanged") {
    return Err({
      statusCode: 202,
      body: JSON.stringify({message: "Message Ignored"})
    })
  }

  return Ok(requestBody)
}
