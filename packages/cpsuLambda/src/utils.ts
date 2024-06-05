import {APIGatewayProxyResult} from "aws-lambda"
import {Err, Ok, Result} from "pratica"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Array<T> {
    /**
     * Collects an array of results into a result of an array.
     * If all results are Ok, returns an Ok with an array of values.
     * If any result is an Err, returns an Err with an array of errors.
     */
    all_ok<O, E>(this: Array<Result<O, E>>): Result<Array<O>, Array<E>>
  }
}

Array.prototype.all_ok = function <O, E>(this: Array<Result<O, E>>): Result<Array<O>, Array<E>> {
  const successes: Array<O> = []
  const failures: Array<E> = []

  for (const result of this) {
    result.cata({
      Ok: (value) => successes.push(value),
      Err: (error) => failures.push(error)
    })
  }

  if (failures.length > 0) {
    return Err(failures)
  } else {
    return Ok(successes)
  }
}

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

export function wrap_with_status(statusCode: number): (body: unknown) => APIGatewayProxyResult {
  return (body) => {
    return {
      statusCode: statusCode,
      body: JSON.stringify(body)
    }
  }
}
