// https://github.com/tbrd/nhs-numbers

import {faker} from "@faker-js/faker"
import {calculateCheckDigit} from "../../src/utils/nhsNumber"

export function generateValidNhsNumbers(num: number, min: number = 100_000_000, max: number = 999_999_999) {
  const numbers: Array<string> = []
  while (numbers.length < num) {
    const numString = faker.number.int({min: min, max: max}).toString()
    let checkDigit = calculateCheckDigit(numString)

    if (checkDigit === 11) {
      checkDigit = 0
    }

    if (checkDigit !== 10) {
      numbers.push(`${numString}${checkDigit}`)
    }
  }
  return numbers
}

export function generateInvalidNhsNumbers(num: number) {
  const numbers: Array<string> = []
  while (numbers.length < num) {
    const numString = faker.number.int({min: 100_000_000, max: 999_999_999}).toString()
    const checkDigit = calculateCheckDigit(numString)

    const invalidCheckDigit = (checkDigit + 1) % 10

    numbers.push(`${numString}${invalidCheckDigit}`)
  }

  return numbers
}
