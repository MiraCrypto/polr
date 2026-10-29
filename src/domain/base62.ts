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
