import {Logger} from "@aws-lambda-powertools/logger"

export function functionWithLoggerPassedIn(logger: Logger) {
  logger.debug("this function has the logger passed in")
}

export function functionWithOutLoggerPassedIn() {
  const logger = new Logger({serviceName: "helper"})
  logger.debug("this function does not have the logger passed in")
}
