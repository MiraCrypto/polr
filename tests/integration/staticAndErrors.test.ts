import { describe, expect, it } from 'vitest'
import { createApplication } from '../../src/app.js'
import { TEST_CONFIGURATION } from '../helpers.js'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('static assets, 404 fallback policies, and 500 error boundary resilience', () => {
  it('serves static assets and short-circuits missing /favicon.ico without database lookups', async () => {
    const { usersRepository, linksRepository } = createInMemoryRepositories()
    let shortUrlLookupCount = 0
    const spyLinksRepository = {
      ...linksRepository,
      async findByShortUrl(shortUrl: string, fallback?: boolean) {
        shortUrlLookupCount++
        return linksRepository.findByShortUrl(shortUrl, fallback)
      },
    }

    const app = createApplication({
      config: {
        ...TEST_CONFIGURATION,
        redirectMissingLinksToIndex: true,
        indexRedirectUrl: 'https://example.org/fallback',
      },
      usersRepository,
      linksRepository: spyLinksRepository,
    })

    const baseJsResponse = await app.request('/js/base.js')
    expect(baseJsResponse.status).toBe(200)
    expect(await baseJsResponse.text()).toContain('X-CSRF-TOKEN')

    const directiveResponse = await app.request('/directives/editLongLinkModal.html')
    expect(directiveResponse.status).toBe(200)
    expect(await directiveResponse.text()).toContain('id="edit-long-link-{{ linkEnding }}"')

    const faviconResponse = await app.request('/favicon.ico')
    expect(faviconResponse.status).toBe(204)
    expect(shortUrlLookupCount).toBe(0)
  })

  it('applies redirectMissingLinksToIndex policy on missing short links and unmatched paths', async () => {
    const { usersRepository, linksRepository } = createInMemoryRepositories()

    const standard404App = createApplication({
      config: { ...TEST_CONFIGURATION, redirectMissingLinksToIndex: false },
      usersRepository,
      linksRepository,
    })
    const missingShort404 = await standard404App.request('/nonexistent')
    expect(missingShort404.status).toBe(404)
    expect(await missingShort404.text()).toContain('This page could not be found.')

    const deepPath404 = await standard404App.request('/unmatched/multi/segment/path')
    expect(deepPath404.status).toBe(404)

    const redirect404App = createApplication({
      config: {
        ...TEST_CONFIGURATION,
        redirectMissingLinksToIndex: true,
        indexRedirectUrl: 'https://example.org/fallback',
      },
      usersRepository,
      linksRepository,
    })
    const redirectedShort = await redirect404App.request('/nonexistent')
    expect(redirectedShort.status).toBe(302)
    expect(redirectedShort.headers.get('location')).toBe('https://example.org/fallback')

    const redirectedDeep = await redirect404App.request('/unmatched/multi/segment/path')
    expect(redirectedDeep.status).toBe(302)
    expect(redirectedDeep.headers.get('location')).toBe('https://example.org/fallback')
  })

  it('logs uncaught errors while rendering a clean 500 error page without leaking stack traces', async () => {
    const { usersRepository, linksRepository } = createInMemoryRepositories()
    const loggedErrors: unknown[] = []
    const failingLinksRepository = {
      ...linksRepository,
      async findByShortUrl(): Promise<never> {
        throw new Error('FATAL: connection to PostgreSQL lost at 10.0.0.12:5432')
      },
    }
    const failingUsersRepository = {
      ...usersRepository,
      async findById(): Promise<never> {
        throw new Error('FATAL: users table unreachable')
      },
    }

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository: failingUsersRepository,
      linksRepository: failingLinksRepository,
      logError: (error) => {
        loggedErrors.push(error)
      },
    })

    const errorResponse = await app.request('/some-short-link')
    expect(errorResponse.status).toBe(500)
    const errorHtml = await errorResponse.text()
    expect(errorHtml).toContain('<h1>500</h1>')
    expect(errorHtml).not.toContain('10.0.0.12:5432')
    expect(loggedErrors).toHaveLength(1)
    expect((loggedErrors[0] as Error).message).toContain('10.0.0.12:5432')
  })
})
