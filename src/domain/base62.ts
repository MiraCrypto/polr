const BASE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function encodeBaseNumber(value: number, radix: 32 | 62 = 62): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Value must be a non-negative integer, received: ${value}`)
  }

  const initialRemainder = value % radix
  let encodedResult = BASE_ALPHABET[initialRemainder] ?? '0'
  let quotient = Math.floor(value / radix)

  while (quotient > 0) {
    const remainder = quotient % radix
    quotient = Math.floor(quotient / radix)
    const character = BASE_ALPHABET[remainder] ?? '0'
    encodedResult = `${character}${encodedResult}`
  }

  return encodedResult
}

export function decodeBaseNumber(encodedValue: string, radix: 32 | 62 = 62): number {
  if (encodedValue.length === 0) {
    throw new RangeError('Encoded value must not be empty')
  }

  let decodedNumber = 0
  for (let index = 0; index < encodedValue.length; index += 1) {
    const character = encodedValue[index] ?? ''
    const digitValue = BASE_ALPHABET.indexOf(character)
    if (digitValue === -1 || digitValue >= radix) {
      throw new RangeError(`Invalid base-${radix} character: ${character}`)
    }
    decodedNumber = radix * decodedNumber + digitValue
  }

  return decodedNumber
}
