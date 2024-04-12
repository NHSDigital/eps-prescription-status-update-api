// Adapted from: https://github.com/tbrd/nhs-numbers

export function validateNhsNumber(nhsNumber: string): boolean {
  if (nhsNumber === undefined || nhsNumber === null || Number.isNaN(Number(nhsNumber))) {
    return false
  }

  const chars = nhsNumber.split("")
  const calculateCheckDigitInput = chars.slice(0, 9).join("")
  let calculatedCheckDigit = calculateCheckDigit(calculateCheckDigitInput)

  if (calculatedCheckDigit === 11) {
    calculatedCheckDigit = 0
  }

  const providedCheckDigit = chars[9]

  return calculatedCheckDigit === Number(providedCheckDigit)
}

export function calculateCheckDigit(numberString: string): number {
  const digits: Array<number> = numberString.split("").map((n) => Number(n))

  const multipliedTotal = digits.reduce(
    (previous: number, current: number, index: number) => previous + (current * (10 - index)), 0
  )

  const remainder = multipliedTotal % 11

  return 11 - remainder
}
