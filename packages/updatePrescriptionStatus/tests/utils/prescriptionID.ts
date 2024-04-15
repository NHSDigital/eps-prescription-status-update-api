import {calculateTotalForCheckDigit, CHECK_DIGIT_VALUES} from "../../src/utils/prescriptionID"

export function generateShortFormID(prescriberOdsCode: string): string {
  const a = generateRandomHexString(6)
  const b = prescriberOdsCode.padStart(6, "0")
  const c = generateRandomHexString(5)
  const checkDigit = calculateCheckDigit(a + b + c)
  return `${a}-${b}-${c}${checkDigit}`
}

function generateRandomHexString(length: number) {
  const randomNumbers = new Uint8Array(length)
  crypto.getRandomValues(randomNumbers)
  return Array.from(randomNumbers)
    .map(randomNumber => (randomNumber % 16).toString(16).toUpperCase())
    .join("")
}

function calculateCheckDigit(input: string) {
  const total = calculateTotalForCheckDigit(input)
  const checkDigitIndex = (38 - total) % 37
  return CHECK_DIGIT_VALUES.charAt(checkDigitIndex)
}
