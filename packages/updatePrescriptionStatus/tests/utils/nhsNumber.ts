// https://github.com/tbrd/nhs-numbers

import {faker} from "@faker-js/faker"

export function generateValidNhsNumbers(num: number) {
  const numbers: Array<string> = []
  while (numbers.length < num) {
    const numString = faker.number.int({min: 100000000, max: 999999999}).toString()
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
    const numString = faker.number.int({min: 100000000, max: 999999999}).toString()
    const checkDigit = calculateCheckDigit(numString)

    const invalidCheckDigit = (checkDigit + 1) % 10

    numbers.push(`${numString}${invalidCheckDigit}`)
  }

  return numbers
}

function calculateCheckDigit(numberString: string): number {
  const digits: Array<number> = numberString.split("").map((n) => Number(n))

  const multipliedTotal = digits.reduce(
    (previous: number, current: number, index: number) => previous + (current * (10 - index)), 0
  )

  const remainder = multipliedTotal % 11

  return 11 - remainder
}
