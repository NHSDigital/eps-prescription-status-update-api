export const CHECK_DIGIT_VALUES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+"

export function validatePrescriptionID(prescriptionID: string): boolean {
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

export function calculateTotalForCheckDigit(input: string) {
  return Array.from(input)
    .map(charStr => parseInt(charStr, 36))
    .reduce((runningTotal, charInt) => ((runningTotal + charInt) * 2) % 37, 0)
}
