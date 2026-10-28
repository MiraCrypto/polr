import { describe, expect, it } from 'vitest'
import { createApplication } from '../../src/app.js'
import { TEST_CONFIGURATION } from '../helpers.js'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('external API v2 endpoints (shorten, shorten_bulk, lookup)', () => {
  it('enforces API key authentication, active flags, per-minute quotas, and plain_text vs json formats', async () => {
    const { state, usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'unlimited_api_user',
          passwordHash: null,
          email: null,
          createdIp: null,
          role: 'user',
          isActive: true,
          apiKey: 'unlimited-key',
          apiActive: true,
          apiQuota: -1,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 2,
          username: 'quota_two_user',
          passwordHash: null,
          email: null,
          createdIp: null,
          role: 'user',
          isActive: true,
          apiKey: 'quota-2-key',
          apiActive: true,
          apiQuota: 2,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 3,
          username: 'disabled_api_user',
          passwordHash: null,
          email: null,
          createdIp: null,
          role: 'user',
          isActive: true,
          apiKey: 'disabled-api-key',
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
      links: [
        // Web-shortened link (isApi: false) should NOT count against quota_two_user's API quota
        {
          id: 10,
          shortUrl: 'web1',
          longUrl: 'https://example.com/web-created',
          createdIp: '127.0.0.1',
          creatorId: 2,
          creatorUsername: 'quota_two_user',
          clicks: 0,
          secretKey: null,
          isDisabled: false,
          isCustom: true,
          isApi: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository,
    })

    const missingKeyResponse = await app.request('/api/v2/action/shorten?response_type=json')
    expect(missingKeyResponse.status).toBe(401)
    expect(missingKeyResponse.headers.get('access-control-allow-origin')).toBe('*')
    expect(await missingKeyResponse.json()).toMatchObject({
      status_code: 401,
      error_code: 'AUTH_ERROR',
    })

    const disabledKeyResponse = await app.request(
      '/api/v2/action/shorten?key=disabled-api-key&url=https://example.com',
    )
    expect(disabledKeyResponse.status).toBe(401)

    const firstQuotaShorten = await app.request(
      '/api/v2/action/shorten?key=quota-2-key&url=https://example.com/q1',
    )
    expect(firstQuotaShorten.status).toBe(200)
    expect(await firstQuotaShorten.text()).toBe('https://short.example.com/0')

    const secondQuotaShorten = await app.request('/api/v2/action/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'quota-2-key',
        url: 'https://example.com/q2 with space',
        is_secret: true,
        response_type: 'json',
      }),
    })
    expect(secondQuotaShorten.status).toBe(200)
    const secondJson = (await secondQuotaShorten.json()) as { action: string, result: string }
    expect(secondJson.action).toBe('shorten')
    expect(secondJson.result).toMatch(/^https:\/\/short\.example\.com\/1\/[0-9a-f]{4}$/)
    expect(state.links.find(l => l.shortUrl === '1')?.longUrl).toBe(
      'https://example.com/q2%20with%20space',
    )

    const thirdQuotaShorten = await app.request(
      '/api/v2/action/shorten?key=quota-2-key&url=https://example.com/q3&response_type=json',
    )
    expect(thirdQuotaShorten.status).toBe(429)
    expect(await thirdQuotaShorten.json()).toMatchObject({
      status_code: 429,
      error_code: 'QUOTA_EXCEEDED',
    })

    const bulkShortenResponse = await app.request('/api/v2/action/shorten_bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        key: 'unlimited-key',
        data: JSON.stringify({
          links: [
            { url: 'https://example.com/b1', custom_ending: 'bulk-one' },
            { url: 'https://example.com/b2', custom_ending: 'bulk-two' },
          ],
        }),
      }).toString(),
    })
    expect(bulkShortenResponse.status).toBe(200)
    const bulkPayload = (await bulkShortenResponse.json()) as {
      result: { shortened_links: Array<{ short_url: string }> }
    }
    expect(bulkPayload.result.shortened_links).toEqual([
      { long_url: 'https://example.com/b1', short_url: 'https://short.example.com/bulk-one' },
      { long_url: 'https://example.com/b2', short_url: 'https://short.example.com/bulk-two' },
    ])

    const lookupResponse = await app.request(
      '/api/v2/action/lookup?key=unlimited-key&url_ending=bulk-one&response_type=json',
    )
    expect(lookupResponse.status).toBe(200)
    const lookupJson = (await lookupResponse.json()) as {
      action: string
      result: { long_url: string, clicks: number }
    }
    expect(lookupJson.result.long_url).toBe('https://example.com/b1')
    expect(lookupJson.result.clicks).toBe(0)
    expect(state.links.find(l => l.shortUrl === 'bulk-one')?.clicks).toBe(0)

    const nullBulkResponse = await app.request('/api/v2/action/shorten_bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: 'unlimited-key', data: 'null' }).toString(),
    })
    expect(nullBulkResponse.status).toBe(400)
    expect(await nullBulkResponse.json()).toMatchObject({ error_code: 'INVALID_PARAMETERS' })

    const reservedLookupResponse = await app.request(
      '/api/v2/action/lookup?key=unlimited-key&url_ending=admin&response_type=json',
    )
    expect(reservedLookupResponse.status).toBe(404)
    expect(await reservedLookupResponse.json()).toMatchObject({ error_code: 'NOT_FOUND' })

    const secretLinkRecord = state.links.find(l => l.shortUrl === '1')
    expect(secretLinkRecord?.secretKey).toBeTruthy()

    const deniedSecretLookup = await app.request(
      '/api/v2/action/lookup?key=unlimited-key&url_ending=1&url_key=wrong&response_type=json',
    )
    expect(deniedSecretLookup.status).toBe(401)

    const validSecretLookup = await app.request(
      `/api/v2/action/lookup?key=unlimited-key&url_ending=1&url_key=${secretLinkRecord?.secretKey}&response_type=plain_text`,
    )
    expect(validSecretLookup.status).toBe(200)
    expect(await validSecretLookup.text()).toBe('https://example.com/q2%20with%20space')
  })
})
