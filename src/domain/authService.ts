import type { FlashMessage, SessionPayload } from './types.js'
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const BCRYPT_SALT_ROUNDS = 10

export function generateRandomHexString(byteLength: number): string {
  return randomBytes(byteLength).toString('hex')
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export async function hashPasswordWithBcrypt(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, BCRYPT_SALT_ROUNDS)
}

export async function verifyPasswordWithBcrypt(
  plainTextPassword: string,
  storedPasswordHash: string | null,
): Promise<boolean> {
  if (storedPasswordHash === null || storedPasswordHash.length === 0) {
    return false
  }
  // PHP's password_hash() emits $2y$ prefixes, which use the identical algorithm to $2a$
  const normalizedHash = storedPasswordHash.startsWith('$2y$')
    ? `$2a$${storedPasswordHash.slice(4)}`
    : storedPasswordHash
  return bcrypt.compare(plainTextPassword, normalizedHash)
}

function signBase64Payload(encodedPayload: string, secretKey: string): string {
  return createHmac('sha256', secretKey).update(encodedPayload).digest('base64url')
}

function serializeSignedPayload(payload: unknown, secretKey: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signBase64Payload(encodedPayload, secretKey)
  return `${encodedPayload}.${signature}`
}

function verifySignedToken<TPayload>(token: string | undefined, secretKey: string): TPayload | null {
  if (token === undefined || token.length === 0) {
    return null
  }
  const separatorIndex = token.lastIndexOf('.')
  if (separatorIndex <= 0) {
    return null
  }

  const encodedPayload = token.slice(0, separatorIndex)
  const providedSignature = token.slice(separatorIndex + 1)
  const expectedSignature = signBase64Payload(encodedPayload, secretKey)

  if (!constantTimeStringEqual(providedSignature, expectedSignature)) {
    return null
  }

  try {
    const decodedJson = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    return JSON.parse(decodedJson) as TPayload
  }
  catch {
    return null
  }
}

export function serializeSignedSessionToken(payload: SessionPayload, secretKey: string): string {
  return serializeSignedPayload(payload, secretKey)
}

export function parseSignedSessionToken(
  token: string | undefined,
  secretKey: string,
  currentEpochSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const parsedPayload = verifySignedToken<SessionPayload>(token, secretKey)
  if (parsedPayload === null) {
    return null
  }
  if (
    typeof parsedPayload.userId !== 'number'
    || typeof parsedPayload.username !== 'string'
    || (parsedPayload.role !== 'user' && parsedPayload.role !== 'admin')
    || typeof parsedPayload.csrfToken !== 'string'
    || typeof parsedPayload.issuedAtEpochSeconds !== 'number'
  ) {
    return null
  }
  if (currentEpochSeconds - parsedPayload.issuedAtEpochSeconds > SESSION_MAX_AGE_SECONDS) {
    return null
  }
  return parsedPayload
}

export function serializeSignedFlashToken(flash: FlashMessage, secretKey: string): string {
  return serializeSignedPayload(flash, secretKey)
}

export function parseSignedFlashToken(token: string | undefined, secretKey: string): FlashMessage | null {
  const parsedFlash = verifySignedToken<FlashMessage>(token, secretKey)
  if (parsedFlash === null) {
    return null
  }
  if (
    (parsedFlash.type !== 'info'
      && parsedFlash.type !== 'error'
      && parsedFlash.type !== 'warning'
      && parsedFlash.type !== 'success')
    || typeof parsedFlash.message !== 'string'
  ) {
    return null
  }
  return parsedFlash
}
