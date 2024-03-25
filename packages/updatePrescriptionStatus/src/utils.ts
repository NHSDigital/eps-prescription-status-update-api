const CHECK_DIGIT_VALUES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+"

function validatePrescriptionID(prescriptionID: string): boolean {
  const checkDigit = prescriptionID.substring(prescriptionID.length - 1)
  const checkDigitRemoved = prescriptionID.substring(0, prescriptionID.length - 1)
  const rawPrescriptionID = checkDigitRemoved.replace(/-/g, "")
  return validateCheckDigit(rawPrescriptionID, checkDigit)
}

function validateCheckDigit(prescriptionID: string, checkDigit: string) {
  const total = calculateTotalForCheckDigit(prescriptionID)
  const checkDigitValue = CHECK_DIGIT_VALUES.indexOf(checkDigit)
  return (total + checkDigitValue) % 37 === 1
}

function calculateTotalForCheckDigit(input: string) {
  return Array.from(input)
    .map(charStr => parseInt(charStr, 36))
    .reduce((runningTotal, charInt) => ((runningTotal + charInt) * 2) % 37, 0)
}

function generateShortFormID(prescriberOdsCode: string): string {
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

export {generateShortFormID, validatePrescriptionID}
