import {Err, Ok, Result} from "pratica"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Array<T> {
    /**
     * Collects an array of results into a result of an array.
     * If all results are Ok, returns an Ok with an array of values.
     * If any result is an Err, returns an Err with an array of errors.
     */
    collect<O, E>(this: Array<Result<O, E>>): Result<Array<O>, Array<E>>
  }
}

Array.prototype.collect = function <O, E>(this: Array<Result<O, E>>): Result<Array<O>, Array<E>> {
  const successes: Array<O> = []
  const failures: Array<E> = []

  for (const result of this) {
    if (result.isOk()) {
      successes.push(result.value() as O)
    } else {
      failures.push(result.value() as E)
    }
  }

  if (failures.length > 0) {
    return Err(failures)
  } else {
    return Ok(successes)
  }
}

export {}
