import {APIGatewayProxyResult} from "aws-lambda"

declare global {
  interface String {
    /**
     * Splits a string into windows of a specified size,
     * with the last window being shorter if the string length is not divisible by the window size.
     *
     * @example
     * // returns ["abc", "def", "gh"]
     * "abcdefgh".windows(3)
     */
    windows(this: string, size: number): Array<string>
  }
}

String.prototype.windows = function (this: string, size: number): Array<string> {
  const result: Array<string> = []

  for (let i = 0; i < this.length; i += size) {
    result.push(this.slice(i, i + size))
  }

  return result
}

export {}

export function wrap_with_status(
  statusCode: number,
  headers: {[key: string]: string}
): (body: unknown) => APIGatewayProxyResult {
  return (body) => {
    return {
      statusCode: statusCode,
      headers: headers,
      body: JSON.stringify(body)
    }
  }
}
