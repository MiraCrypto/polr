import type { ApplicationConfiguration } from '../config.js'
import type { LinksRepository } from '../db/repositories.js'
import { generateRandomHexString } from './authService.js'
import { encodeBaseNumber } from './base62.js'

const MAXIMUM_LONG_URL_LENGTH = 65535
const MAX_COUNTER_ALLOCATION_ATTEMPTS = 32
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505'
const VALID_ENDING_PATTERN = /^[\w-]+$/

export const RESERVED_ROUTE_ENDINGS = new Set([
  'admin',
  'login',
  'logout',
  'shorten',
  'about-polr',
  'api',
  'css',
  'js',
  'img',
  'fonts',
  'directives',
  'favicon.ico',
  'setup',
  'signup',
  'lost_password',
  'reset_password',
  'activate',
])

const KNOWN_SHORTENER_DOMAINS = [
  'polr.me',
  'bit.ly',
  'is.gd',
  'tiny.cc',
  'adf.ly',
  'ur1.ca',
  'goo.gl',
  'ow.ly',
  'j.mp',
  't.co',
] as const

export class LinkValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'LinkValidationError'
  }
}

export function isDatabaseUniqueConstraintViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false
  }
  const candidate = error as { readonly code?: unknown }
  return candidate.code === POSTGRES_UNIQUE_VIOLATION_CODE
}

export function isValidHttpUrl(candidateUrl: string): boolean {
  if (candidateUrl.trim().length === 0) {
    return false
  }
  try {
    const parsedUrl = new URL(candidateUrl)
    return (
      (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'ftp:')
      && parsedUrl.hostname.length > 0
    )
  }
  catch {
    return false
  }
}

export function isValidEndingSyntax(linkEnding: string): boolean {
  if (linkEnding.length === 0) {
    return false
  }
  return VALID_ENDING_PATTERN.test(linkEnding)
}

export function isReservedRouteEnding(linkEnding: string): boolean {
  return RESERVED_ROUTE_ENDINGS.has(linkEnding.toLowerCase())
}

export function checkIfAlreadyShortenedUrl(longUrl: string, appAddress: string): boolean {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(longUrl)
  }
  catch {
    return false
  }

  const candidateHost = parsedUrl.host.toLowerCase()
  const candidateHostname = parsedUrl.hostname.toLowerCase()
  const normalizedAppAddress = appAddress.trim().toLowerCase().replace(/\/+$/, '')

  if (normalizedAppAddress.length > 0) {
    const matchesAppHost = normalizedAppAddress.includes(':')
      ? candidateHost === normalizedAppAddress
      : candidateHostname === normalizedAppAddress
    if (matchesAppHost) {
      return true
    }
  }

  for (const shortenerDomain of KNOWN_SHORTENER_DOMAINS) {
    if (
      candidateHostname === shortenerDomain
      || candidateHostname.endsWith(`.${shortenerDomain}`)
    ) {
      return true
    }
  }

  return false
}

export function formatShortenedUrl(
  config: ApplicationConfiguration,
  linkEnding: string,
  secretKey: string | null = null,
): string {
  const baseShortUrl = `${config.appProtocol}${config.appAddress}/${linkEnding}`
  if (secretKey !== null && secretKey.length > 0) {
    return `${baseShortUrl}/${secretKey}`
  }
  return baseShortUrl
}

export interface ShortenLinkInput {
  readonly longUrl: string
  readonly isSecret: boolean
  readonly customEnding: string | null
  readonly createdIp: string
  readonly creatorId: number | null
  readonly isApi: boolean
}

export async function createShortenedLink(
  linksRepository: LinksRepository,
  config: ApplicationConfiguration,
  input: ShortenLinkInput,
): Promise<string> {
  if (input.longUrl.length > MAXIMUM_LONG_URL_LENGTH) {
    throw new LinkValidationError('Sorry, but your link is longer than the maximum length allowed.')
  }

  if (checkIfAlreadyShortenedUrl(input.longUrl, config.appAddress)) {
    throw new LinkValidationError('Sorry, but your link already looks like a shortened URL.')
  }

  const trimmedCustomEnding = input.customEnding?.trim() ?? ''
  const hasCustomEnding = trimmedCustomEnding.length > 0

  if (!input.isSecret && !hasCustomEnding) {
    const existingLink = await linksRepository.findExistingNonCustomLink(
      input.longUrl,
      input.creatorId,
    )
    if (existingLink !== null) {
      return formatShortenedUrl(config, existingLink.shortUrl)
    }
  }

  const secretKey = input.isSecret
    ? generateRandomHexString(config.polrSecretBytes)
    : null

  if (hasCustomEnding) {
    if (!isValidEndingSyntax(trimmedCustomEnding)) {
      throw new LinkValidationError(
        'Custom endings can only contain alphanumeric characters, hyphens, and underscores.',
      )
    }

    if (isReservedRouteEnding(trimmedCustomEnding)) {
      throw new LinkValidationError('This URL ending is already in use.')
    }

    const existingCustomLink = await linksRepository.findByShortUrl(trimmedCustomEnding, true)
    if (existingCustomLink !== null) {
      throw new LinkValidationError('This URL ending is already in use.')
    }

    try {
      await linksRepository.createLink({
        shortUrl: trimmedCustomEnding,
        longUrl: input.longUrl,
        createdIp: input.createdIp,
        creatorId: input.creatorId,
        secretKey,
        isCustom: true,
        isApi: input.isApi,
      })
    }
    catch (error) {
      if (isDatabaseUniqueConstraintViolation(error)) {
        throw new LinkValidationError('This URL ending is already in use.')
      }
      throw error
    }

    return formatShortenedUrl(config, trimmedCustomEnding, secretKey)
  }

  for (let attempt = 0; attempt < MAX_COUNTER_ALLOCATION_ATTEMPTS; attempt++) {
    const nextCounter = await linksRepository.allocateNextCounterValue()
    const encodedCandidate = encodeBaseNumber(nextCounter, config.polrBase)
    if (isReservedRouteEnding(encodedCandidate)) {
      continue
    }
    const collision = await linksRepository.findByShortUrl(encodedCandidate, false)
    if (collision !== null) {
      continue
    }

    try {
      await linksRepository.createLink({
        shortUrl: encodedCandidate,
        longUrl: input.longUrl,
        createdIp: input.createdIp,
        creatorId: input.creatorId,
        secretKey,
        isCustom: false,
        isApi: input.isApi,
      })
      return formatShortenedUrl(config, encodedCandidate, secretKey)
    }
    catch (error) {
      if (isDatabaseUniqueConstraintViolation(error)) {
        continue
      }
      throw error
    }
  }

  throw new Error('Failed to allocate a unique link ending.')
}
