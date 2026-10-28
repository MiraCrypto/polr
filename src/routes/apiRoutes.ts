import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApplicationDependencies } from '../app.js'
import type { LinksRepository, UsersRepository } from '../db/repositories.js'
import type { UserRecord } from '../domain/types.js'
import { constantTimeStringEqual } from '../domain/authService.js'
import { formatUtcTimestamp } from '../domain/dataTables.js'
import {
  createShortenedLink,
  isValidEndingSyntax,
  isValidHttpUrl,
  LinkValidationError,
} from '../domain/linkService.js'
import {
  extractClientIpAddress,
  parseRequestFormOrJsonFields,
} from './requestContext.js'

const ONE_MINUTE_MILLISECONDS = 60_000
const MAX_BULK_SHORTEN_LINKS = 100

function sendApiSuccessResponse(
  context: Context,
  action: string,
  result: unknown,
  responseType: string,
  plainTextOverride?: string,
): Response {
  if (responseType === 'json') {
    return context.json(
      { action, result },
      200,
      { 'Access-Control-Allow-Origin': '*' },
    )
  }

  const textBody = plainTextOverride ?? (typeof result === 'string'
    ? result
    : JSON.stringify(result))
  return context.text(
    textBody,
    200,
    { 'Access-Control-Allow-Origin': '*' },
  )
}

function sendApiErrorResponse(
  context: Context,
  errorCode: string,
  errorMessage: string,
  statusCode: ContentfulStatusCode,
  responseType: string,
): Response {
  if (responseType === 'json') {
    return context.json(
      {
        status_code: statusCode,
        error_code: errorCode,
        error: errorMessage,
      },
      statusCode,
      { 'Access-Control-Allow-Origin': '*' },
    )
  }

  return context.text(
    `${statusCode} ${errorMessage}`,
    statusCode,
    { 'Access-Control-Allow-Origin': '*' },
  )
}

async function authenticateApiRequest(
  context: Context,
  fields: Record<string, string>,
  usersRepository: UsersRepository,
  linksRepository: LinksRepository,
  defaultResponseType: string = 'plain_text',
): Promise<{
  readonly user: UserRecord
  readonly responseType: string
  readonly recentApiLinksCount: number
} | Response> {
  const responseType = fields['response_type'] ?? defaultResponseType
  const apiKey = fields['key']?.trim() ?? ''

  if (apiKey.length === 0) {
    return sendApiErrorResponse(
      context,
      'AUTH_ERROR',
      'Authentication token required.',
      401,
      responseType,
    )
  }

  const user = await usersRepository.findActiveByApiKey(apiKey)
  if (user === null) {
    return sendApiErrorResponse(
      context,
      'AUTH_ERROR',
      'Authentication token invalid.',
      401,
      responseType,
    )
  }

  let recentApiLinksCount = 0
  if (user.apiQuota >= 0) {
    const oneMinuteAgo = new Date(Date.now() - ONE_MINUTE_MILLISECONDS)
    recentApiLinksCount = await linksRepository.countRecentApiLinksByCreator(
      user.id,
      oneMinuteAgo,
    )
    if (recentApiLinksCount >= user.apiQuota) {
      return sendApiErrorResponse(
        context,
        'QUOTA_EXCEEDED',
        'Quota exceeded.',
        429,
        responseType,
      )
    }
  }

  return { user, responseType, recentApiLinksCount }
}

export function registerApiRoutes(app: Hono, dependencies: ApplicationDependencies): void {
  const { config, usersRepository, linksRepository } = dependencies

  async function handleShortenAction(context: Context): Promise<Response> {
    const fields = await parseRequestFormOrJsonFields(context)
    const authResult = await authenticateApiRequest(
      context,
      fields,
      usersRepository,
      linksRepository,
      'plain_text',
    )
    if (authResult instanceof Response) {
      return authResult
    }

    const { user, responseType } = authResult
    const rawUrl = (fields['url'] ?? '').replace(/ /g, '%20')
    if (!isValidHttpUrl(rawUrl)) {
      return sendApiErrorResponse(
        context,
        'MISSING_PARAMETERS',
        'Invalid or missing parameters.',
        400,
        responseType,
      )
    }

    const isSecret = fields['is_secret'] === 'true'
    const customEnding = fields['custom_ending']?.trim() ?? ''

    try {
      const shortenedUrl = await createShortenedLink(linksRepository, config, {
        longUrl: rawUrl,
        isSecret,
        customEnding: customEnding.length > 0
          ? customEnding
          : null,
        createdIp: extractClientIpAddress(context),
        creatorId: user.id,
        isApi: true,
      })

      return sendApiSuccessResponse(context, 'shorten', shortenedUrl, responseType)
    }
    catch (error) {
      const message = error instanceof LinkValidationError
        ? error.message
        : 'Creation error.'
      return sendApiErrorResponse(context, 'CREATION_ERROR', message, 400, responseType)
    }
  }

  app.get('/api/v2/action/shorten', handleShortenAction)
  app.post('/api/v2/action/shorten', handleShortenAction)

  app.post('/api/v2/action/shorten_bulk', async (context) => {
    const fields = await parseRequestFormOrJsonFields(context)
    const authResult = await authenticateApiRequest(
      context,
      fields,
      usersRepository,
      linksRepository,
      'json',
    )
    if (authResult instanceof Response) {
      return authResult
    }

    const { user, responseType, recentApiLinksCount } = authResult
    if (responseType !== 'json') {
      return sendApiErrorResponse(
        context,
        'JSON_ONLY',
        'Only JSON-encoded responses are available for this endpoint.',
        401,
        responseType,
      )
    }

    const rawDataJson = fields['data'] ?? ''
    let parsedData: unknown
    try {
      parsedData = JSON.parse(rawDataJson)
    }
    catch {
      return sendApiErrorResponse(context, 'INVALID_PARAMETERS', 'Invalid JSON.', 400, 'json')
    }

    if (parsedData === null || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      return sendApiErrorResponse(context, 'INVALID_PARAMETERS', 'Invalid JSON.', 400, 'json')
    }

    const rawLinks = (parsedData as { readonly links?: unknown }).links
    if (!Array.isArray(rawLinks) || rawLinks.length > MAX_BULK_SHORTEN_LINKS) {
      return sendApiErrorResponse(
        context,
        'MISSING_PARAMETERS',
        'Invalid or missing parameters.',
        400,
        'json',
      )
    }

    const normalizedLinkItems: Array<{
      readonly longUrl: string
      readonly isSecret: boolean
      readonly customEnding: string | null
    }> = []

    for (const rawItem of rawLinks) {
      if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        return sendApiErrorResponse(
          context,
          'MISSING_PARAMETERS',
          'Invalid or missing parameters.',
          400,
          'json',
        )
      }
      const itemRecord = rawItem as Record<string, unknown>
      const rawUrl = typeof itemRecord['url'] === 'string'
        ? itemRecord['url'].replace(/ /g, '%20')
        : ''
      if (!isValidHttpUrl(rawUrl)) {
        return sendApiErrorResponse(
          context,
          'MISSING_PARAMETERS',
          'Invalid or missing parameters.',
          400,
          'json',
        )
      }
      normalizedLinkItems.push({
        longUrl: rawUrl,
        isSecret: String(itemRecord['is_secret'] ?? '') === 'true',
        customEnding: typeof itemRecord['custom_ending'] === 'string'
          ? itemRecord['custom_ending']
          : null,
      })
    }

    if (user.apiQuota >= 0 && recentApiLinksCount + normalizedLinkItems.length > user.apiQuota) {
      return sendApiErrorResponse(
        context,
        'QUOTA_EXCEEDED',
        'Quota exceeded.',
        429,
        'json',
      )
    }

    const clientIp = extractClientIpAddress(context)
    const shortenedLinks: Array<{ readonly long_url: string, readonly short_url: string }> = []

    try {
      for (const item of normalizedLinkItems) {
        const shortenedUrl = await createShortenedLink(linksRepository, config, {
          longUrl: item.longUrl,
          isSecret: item.isSecret,
          customEnding: item.customEnding,
          createdIp: clientIp,
          creatorId: user.id,
          isApi: true,
        })

        shortenedLinks.push({
          long_url: item.longUrl,
          short_url: shortenedUrl,
        })
      }
    }
    catch (error) {
      const message = error instanceof LinkValidationError
        ? error.message
        : 'Creation error.'
      return sendApiErrorResponse(context, 'CREATION_ERROR', message, 400, 'json')
    }

    return sendApiSuccessResponse(
      context,
      'shorten_bulk',
      { shortened_links: shortenedLinks },
      'json',
    )
  })

  async function handleLookupAction(context: Context): Promise<Response> {
    const fields = await parseRequestFormOrJsonFields(context)
    const authResult = await authenticateApiRequest(
      context,
      fields,
      usersRepository,
      linksRepository,
      'plain_text',
    )
    if (authResult instanceof Response) {
      return authResult
    }

    const { responseType } = authResult
    const urlEnding = fields['url_ending']?.trim() ?? ''
    if (!isValidEndingSyntax(urlEnding)) {
      return sendApiErrorResponse(
        context,
        'MISSING_PARAMETERS',
        'Invalid or missing parameters.',
        400,
        responseType,
      )
    }

    const link = await linksRepository.findByShortUrl(urlEnding, true)
    if (link === null) {
      return sendApiErrorResponse(
        context,
        'NOT_FOUND',
        'Link not found.',
        404,
        responseType,
      )
    }

    const providedUrlKey = fields['url_key'] ?? ''
    if (
      link.secretKey !== null
      && link.secretKey.length > 0
      && !constantTimeStringEqual(providedUrlKey, link.secretKey)
    ) {
      return sendApiErrorResponse(
        context,
        'ACCESS_DENIED',
        'Invalid URL code for secret URL.',
        401,
        responseType,
      )
    }

    return sendApiSuccessResponse(
      context,
      'lookup',
      {
        long_url: link.longUrl,
        created_at: formatUtcTimestamp(link.createdAt),
        clicks: link.clicks,
        updated_at: formatUtcTimestamp(link.updatedAt),
      },
      responseType,
      link.longUrl,
    )
  }

  app.get('/api/v2/action/lookup', handleLookupAction)
  app.post('/api/v2/action/lookup', handleLookupAction)
}
