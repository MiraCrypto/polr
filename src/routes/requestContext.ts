import type { Context } from 'hono'
import type { ApplicationConfiguration } from '../config.js'
import type { UsersRepository } from '../db/repositories.js'
import type { FlashMessage, FlashMessageType, SessionPayload, UserRecord } from '../domain/types.js'
import type { PageRenderContext } from '../views/pages.js'
import { isIP } from 'node:net'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  constantTimeStringEqual,
  generateRandomHexString,
  parseSignedFlashToken,
  parseSignedSessionToken,
  serializeSignedFlashToken,
  serializeSignedSessionToken,
} from '../domain/authService.js'

const SESSION_COOKIE_NAME = 'polr_session'
const CSRF_COOKIE_NAME = 'polr_csrf'
const FLASH_COOKIE_NAME = 'polr_flash'
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const FLASH_COOKIE_MAX_AGE_SECONDS = 300
const CSRF_TOKEN_BYTE_LENGTH = 16
const MINIMUM_CSRF_COOKIE_HEX_LENGTH = 32
const DEFAULT_FALLBACK_CLIENT_IP = '127.0.0.1'

function shouldUseSecureCookies(config: ApplicationConfiguration): boolean {
  return config.appProtocol === 'https://'
}

function buildCookieDeletionOptions(config: ApplicationConfiguration): {
  readonly path: string
  readonly httpOnly: boolean
  readonly sameSite: 'Lax'
  readonly secure: boolean
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(config),
  }
}

export function extractClientIpAddress(context: Context): string {
  const realIpHeader = context.req.header('x-real-ip')?.trim()
  if (realIpHeader !== undefined && isIP(realIpHeader) !== 0) {
    return realIpHeader
  }

  const forwardedForHeader = context.req.header('x-forwarded-for')
  if (forwardedForHeader !== undefined) {
    const firstForwardedIp = forwardedForHeader.split(',')[0]?.trim()
    if (firstForwardedIp !== undefined && isIP(firstForwardedIp) !== 0) {
      return firstForwardedIp
    }
  }

  return DEFAULT_FALLBACK_CLIENT_IP
}

export async function resolveCurrentUser(
  context: Context,
  config: ApplicationConfiguration,
  usersRepository: UsersRepository,
): Promise<{ readonly user: UserRecord | null, readonly session: SessionPayload | null }> {
  const rawSessionCookie = getCookie(context, SESSION_COOKIE_NAME)
  const session = parseSignedSessionToken(rawSessionCookie, config.appKey)
  if (session === null) {
    return { user: null, session: null }
  }

  const user = await usersRepository.findById(session.userId, false)
  if (user === null) {
    deleteCookie(context, SESSION_COOKIE_NAME, buildCookieDeletionOptions(config))
    return { user: null, session: null }
  }

  return { user, session }
}

export function getOrIssueCsrfToken(
  context: Context,
  config: ApplicationConfiguration,
  session: SessionPayload | null,
): string {
  if (session !== null) {
    return session.csrfToken
  }

  const existingCsrfCookie = getCookie(context, CSRF_COOKIE_NAME)
  if (
    existingCsrfCookie !== undefined
    && existingCsrfCookie.length >= MINIMUM_CSRF_COOKIE_HEX_LENGTH
  ) {
    return existingCsrfCookie
  }

  const newCsrfToken = generateRandomHexString(CSRF_TOKEN_BYTE_LENGTH)
  setCookie(context, CSRF_COOKIE_NAME, newCsrfToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(config),
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
  return newCsrfToken
}

export function verifyCsrfTokenFromRequest(
  context: Context,
  session: SessionPayload | null,
  bodyToken?: string,
): boolean {
  const expectedToken = session !== null
    ? session.csrfToken
    : getCookie(context, CSRF_COOKIE_NAME)

  if (expectedToken === undefined || expectedToken.length === 0) {
    return false
  }

  const headerToken = context.req.header('x-csrf-token')
  const providedToken = headerToken ?? bodyToken
  if (providedToken === undefined || providedToken.length === 0) {
    return false
  }

  return constantTimeStringEqual(providedToken, expectedToken)
}

export function setSignedUserSessionCookie(
  context: Context,
  config: ApplicationConfiguration,
  user: UserRecord,
): SessionPayload {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    csrfToken: generateRandomHexString(CSRF_TOKEN_BYTE_LENGTH),
    issuedAtEpochSeconds: Math.floor(Date.now() / 1000),
  }

  const signedToken = serializeSignedSessionToken(payload, config.appKey)
  setCookie(context, SESSION_COOKIE_NAME, signedToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(config),
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
  return payload
}

export function clearUserSessionCookie(context: Context, config: ApplicationConfiguration): void {
  deleteCookie(context, SESSION_COOKIE_NAME, buildCookieDeletionOptions(config))
}

export function setFlashMessageCookie(
  context: Context,
  config: ApplicationConfiguration,
  type: FlashMessageType,
  message: string,
): void {
  const signedFlash = serializeSignedFlashToken({ type, message }, config.appKey)
  setCookie(context, FLASH_COOKIE_NAME, signedFlash, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(config),
    maxAge: FLASH_COOKIE_MAX_AGE_SECONDS,
  })
}

export function consumeFlashMessages(
  context: Context,
  config: ApplicationConfiguration,
): readonly FlashMessage[] {
  const rawFlashCookie = getCookie(context, FLASH_COOKIE_NAME)
  if (rawFlashCookie === undefined) {
    return []
  }

  deleteCookie(context, FLASH_COOKIE_NAME, buildCookieDeletionOptions(config))
  const parsedFlash = parseSignedFlashToken(rawFlashCookie, config.appKey)
  return parsedFlash !== null
    ? [parsedFlash]
    : []
}

export async function buildPageRenderContext(
  context: Context,
  config: ApplicationConfiguration,
  usersRepository: UsersRepository,
  additionalFlashMessages: readonly FlashMessage[] = [],
): Promise<PageRenderContext> {
  const { user, session } = await resolveCurrentUser(context, config, usersRepository)
  const csrfToken = getOrIssueCsrfToken(context, config, session)
  const cookieFlashes = consumeFlashMessages(context, config)

  return {
    config,
    csrfToken,
    currentUser: user,
    flashMessages: [
      ...cookieFlashes,
      ...additionalFlashMessages,
    ],
  }
}

export async function parseRequestFormOrJsonFields(
  context: Context,
): Promise<Record<string, string>> {
  const mergedFields: Record<string, string> = {}

  const requestUrl = new URL(context.req.url, 'http://localhost')
  for (const [key, value] of requestUrl.searchParams.entries()) {
    mergedFields[key] = value
  }

  const method = context.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    return mergedFields
  }

  const contentType = (context.req.header('content-type') ?? '').toLowerCase()
  try {
    if (contentType.includes('application/json')) {
      const parsedJson = (await context.req.json()) as Record<string, unknown>
      for (const [key, value] of Object.entries(parsedJson)) {
        if (typeof value === 'string') {
          mergedFields[key] = value
        }
        else if (typeof value === 'number' || typeof value === 'boolean') {
          mergedFields[key] = String(value)
        }
        else if (value !== null && value !== undefined) {
          mergedFields[key] = JSON.stringify(value)
        }
      }
    }
    else {
      const parsedBody = await context.req.parseBody()
      for (const [key, value] of Object.entries(parsedBody)) {
        if (typeof value === 'string') {
          mergedFields[key] = value
        }
      }
    }
  }
  catch {
    // Ignore malformed body and return query parameters
  }

  return mergedFields
}
