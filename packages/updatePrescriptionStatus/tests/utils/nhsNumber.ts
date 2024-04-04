// https://github.com/tbrd/nhs-numbers

import {faker} from "@faker-js/faker"

export function generateValidNhsNumbers(num: number) {
  const numbers: Array<string> = []
  while (numbers.length < num) {
    const number = faker.number.int({min: 100000000, max: 999999999}).toString()
    const multipliedTotal = number.split("").reduce((acc, curr, i) => acc + (Number(curr) * (10 - i)), 0)
    const remainder = multipliedTotal % 11
    let checkDigit = 11 - remainder

    if (checkDigit === 11) {
      checkDigit = 0
    }

    if (checkDigit !== 10) {
      numbers.push(`${number}${checkDigit}`)
    }
  }

  return numbers
}

export function generateInvalidNhsNumbers(num: number) {
  const numbers: Array<string> = []

  while (numbers.length < num) {
    const number = faker.number.int({min: 100000000, max: 999999999}).toString()
    const multipliedTotal = number.split("").reduce(
      (acc: number, curr: string, i: number) => acc + (Number(curr) * (10 - i)), 0)
    const remainder = multipliedTotal % 11
    const checkDigit = 11 - remainder

    if (checkDigit === 10) {
      numbers.push(`${number}${checkDigit}`)
    }

  }

  return numbers
}
