import { describe, expect, it } from 'vitest'
import { createApplication } from '../../src/app.js'
import { hashPasswordWithBcrypt, verifyPasswordWithBcrypt } from '../../src/domain/authService.js'
import {
  authenticateSession,
  extractCookiesFromResponse,
  extractCsrfTokenFromHtml,
  TEST_CONFIGURATION,
} from '../helpers.js'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('web routes, session lifecycle, shortening, and redirect contracts', () => {
  it('enforces publicInterfaceEnabled policy on GET / for unauthenticated and authenticated requests', async () => {
    const passwordHash = await hashPasswordWithBcrypt('user-password')
    const { usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'standard_user',
          passwordHash,
          email: 'user@example.com',
          createdIp: '192.0.2.1',
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    const privateApp = createApplication({
      config: { ...TEST_CONFIGURATION, publicInterfaceEnabled: false, indexRedirectUrl: '' },
      usersRepository,
      linksRepository,
    })
    const unauthedRoot = await privateApp.request('/')
    expect(unauthedRoot.status).toBe(302)
    expect(unauthedRoot.headers.get('location')).toBe('/login')

    const customRedirectApp = createApplication({
      config: {
        ...TEST_CONFIGURATION,
        publicInterfaceEnabled: false,
        indexRedirectUrl: 'https://example.org/welcome',
      },
      usersRepository,
      linksRepository,
    })
    const customRoot = await customRedirectApp.request('/')
    expect(customRoot.status).toBe(302)
    expect(customRoot.headers.get('location')).toBe('https://example.org/welcome')

    const publicApp = createApplication({
      config: { ...TEST_CONFIGURATION, publicInterfaceEnabled: true },
      usersRepository,
      linksRepository,
    })
    const publicRoot = await publicApp.request('/')
    expect(publicRoot.status).toBe(200)
    const publicHtml = await publicRoot.text()
    expect(publicHtml).toContain('action=\'/shorten\'')
    expect(publicHtml).toContain('id=\'check-link-availability\'')
    expect(publicHtml).toContain('<a href="/login">Sign In</a>')
    expect(publicHtml).not.toContain('login-dropdown-menu')

    const { sessionCookies } = await authenticateSession(
      privateApp,
      'standard_user',
      'user-password',
    )
    const authedRoot = await privateApp.request('/', {
      headers: { Cookie: sessionCookies },
    })
    expect(authedRoot.status).toBe(200)
  })

  it('rejects invalid credentials, inactive accounts, CSRF tampering, and mid-session deactivation', async () => {
    const activeHash = await hashPasswordWithBcrypt('valid-pw')
    const inactiveHash = await hashPasswordWithBcrypt('inactive-pw')
    const { usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'active_member',
          passwordHash: activeHash,
          email: 'active@example.com',
          createdIp: '192.0.2.1',
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 2,
          username: 'inactive_member',
          passwordHash: inactiveHash,
          email: 'inactive@example.com',
          createdIp: '192.0.2.2',
          role: 'user',
          isActive: false,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository,
    })

    const loginGet = await app.request('/login')
    expect(loginGet.status).toBe(200)
    const loginHtml = await loginGet.text()
    expect(loginHtml).toContain('<title>Sign In - Test Shortener</title>')
    expect(loginHtml).toContain('<h1>Sign In</h1>')
    expect(loginHtml).toContain('class="form-control login-field"')
    expect(loginHtml).toContain('class="login-submit btn btn-success"')
    expect(loginHtml).toContain('action="/login"')
    expect(loginHtml).toContain('<a href="/login">Sign In</a>')
    expect(loginHtml).not.toContain('login-dropdown-menu')

    const csrf = extractCsrfTokenFromHtml(loginHtml)
    const cookies = extractCookiesFromResponse(loginGet)

    const badCsrfLogin = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
      body: new URLSearchParams({
        username: 'active_member',
        password: 'valid-pw',
        _token: 'tampered-csrf',
      }).toString(),
    })
    expect(badCsrfLogin.status).toBe(302)
    expect(badCsrfLogin.headers.get('location')).toBe('/login')
    expect(extractCookiesFromResponse(badCsrfLogin)).not.toContain('polr_session=')

    const inactiveLogin = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
      body: new URLSearchParams({
        username: 'inactive_member',
        password: 'inactive-pw',
        _token: csrf,
      }).toString(),
    })
    expect(inactiveLogin.status).toBe(302)
    expect(inactiveLogin.headers.get('location')).toBe('/login')
    expect(extractCookiesFromResponse(inactiveLogin)).not.toContain('polr_session=')

    const { sessionCookies } = await authenticateSession(app, 'active_member', 'valid-pw')

    const authedLoginGet = await app.request('/login', {
      headers: { Cookie: sessionCookies },
    })
    expect(authedLoginGet.status).toBe(302)
    expect(authedLoginGet.headers.get('location')).toBe('/')

    await usersRepository.toggleUserActive(1)

    const adminAfterDeactivation = await app.request('/admin', {
      headers: { Cookie: sessionCookies },
    })
    expect(adminAfterDeactivation.status).toBe(302)
    expect(adminAfterDeactivation.headers.get('location')).toBe('/login')
  })

  it('handles URL shortening deduplication, custom endings, secret links, and validation errors', async () => {
    const passwordHash = await hashPasswordWithBcrypt('shortener-pw')
    const { state, usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'creator_one',
          passwordHash,
          email: 'c1@example.com',
          createdIp: '192.0.2.1',
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    const app = createApplication({
      config: { ...TEST_CONFIGURATION, publicInterfaceEnabled: true, shortenRequiresLogin: false },
      usersRepository,
      linksRepository,
    })

    const { sessionCookies, csrfToken } = await authenticateSession(
      app,
      'creator_one',
      'shortener-pw',
    )

    const firstShorten = await app.request('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
      body: new URLSearchParams({
        'link-url': 'https://example.com/dedup-target',
        'custom-ending': '',
        'options': 'p',
        '_token': csrfToken,
      }).toString(),
    })
    expect(firstShorten.status).toBe(200)
    expect(await firstShorten.text()).toContain('https://short.example.com/0')
    expect(state.links).toHaveLength(1)

    const duplicateShorten = await app.request('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
      body: new URLSearchParams({
        'link-url': 'https://example.com/dedup-target',
        'custom-ending': '',
        'options': 'p',
        '_token': csrfToken,
      }).toString(),
    })
    expect(duplicateShorten.status).toBe(200)
    expect(await duplicateShorten.text()).toContain('https://short.example.com/0')
    expect(state.links).toHaveLength(1)

    // Secret links ('options' = 's') intentionally bypass deduplication so each secret URL gets a distinct token
    const secretShorten = await app.request('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
      body: new URLSearchParams({
        'link-url': 'https://example.com/dedup-target',
        'custom-ending': '',
        'options': 's',
        '_token': csrfToken,
      }).toString(),
    })
    expect(secretShorten.status).toBe(200)
    const secretHtml = await secretShorten.text()
    expect(secretHtml).toMatch(/https:\/\/short\.example\.com\/1\/[0-9a-f]{4}/)
    expect(state.links).toHaveLength(2)

    const jsUrlShorten = await app.request('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
      body: new URLSearchParams({
        'link-url': 'javascript:alert(1)',
        'custom-ending': '',
        'options': 'p',
        '_token': csrfToken,
      }).toString(),
    })
    expect(jsUrlShorten.status).toBe(302)
    expect(state.links).toHaveLength(2)

    const selfDomainShorten = await app.request('/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': sessionCookies },
      body: new URLSearchParams({
        'link-url': 'https://short.example.com/0',
        'custom-ending': '',
        'options': 'p',
        '_token': csrfToken,
      }).toString(),
    })
    expect(selfDomainShorten.status).toBe(302)
    expect(state.links).toHaveLength(2)
  })

  it('distinguishes case-insensitive custom link redirects from case-sensitive Base-62 counter links', async () => {
    const { state, usersRepository, linksRepository } = createInMemoryRepositories({
      links: [
        {
          id: 1,
          shortUrl: 'CustomUpper',
          longUrl: 'https://example.com/custom-target',
          createdIp: '127.0.0.1',
          creatorId: null,
          creatorUsername: null,
          clicks: 0,
          secretKey: null,
          isDisabled: false,
          isCustom: true,
          isApi: false,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 2,
          shortUrl: '1A',
          longUrl: 'https://example.com/counter-uppercase',
          createdIp: '127.0.0.1',
          creatorId: null,
          creatorUsername: null,
          clicks: 0,
          secretKey: null,
          isDisabled: false,
          isCustom: false,
          isApi: false,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository,
    })

    const customLowerResponse = await app.request('/customupper')
    expect(customLowerResponse.status).toBe(301)
    expect(customLowerResponse.headers.get('location')).toBe('https://example.com/custom-target')
    expect(state.links[0]?.clicks).toBe(1)

    // Base-62 uses both uppercase and lowercase characters as distinct digits, so non-custom links must match case-sensitively
    const counterExactResponse = await app.request('/1A')
    expect(counterExactResponse.status).toBe(301)
    expect(counterExactResponse.headers.get('location')).toBe('https://example.com/counter-uppercase')

    const counterDifferentCaseResponse = await app.request('/1a')
    expect(counterDifferentCaseResponse.status).toBe(404)

    // Transient database write failures during click counting must never break link redirects
    const clickWriteErrors: unknown[] = []
    const resilientRedirectApp = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository: {
        ...linksRepository,
        async incrementClicks(): Promise<never> {
          throw new Error('read-only transaction during failover')
        },
      },
      logError: (error) => {
        clickWriteErrors.push(error)
      },
    })
    const redirectUnderWriteFailure = await resilientRedirectApp.request('/1A')
    expect(redirectUnderWriteFailure.status).toBe(301)
    expect(redirectUnderWriteFailure.headers.get('location')).toBe('https://example.com/counter-uppercase')
    expect(clickWriteErrors).toHaveLength(1)
  })

  it('renders role-specific dashboard tabs and build metadata, and updates passwords', async () => {
    const userHash = await hashPasswordWithBcrypt('user-pw')
    const devHash = await hashPasswordWithBcrypt('dev-pw')
    const adminHash = await hashPasswordWithBcrypt('admin-pw')

    const { state, usersRepository, linksRepository } = createInMemoryRepositories({
      users: [
        {
          id: 1,
          username: 'basic_user',
          passwordHash: userHash,
          email: 'basic@example.com',
          createdIp: '127.0.0.1',
          role: 'user',
          isActive: true,
          apiKey: null,
          apiActive: false,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 2,
          username: 'dev_user',
          passwordHash: devHash,
          email: 'dev@example.com',
          createdIp: '127.0.0.1',
          role: 'user',
          isActive: true,
          apiKey: 'dev-api-key-999',
          apiActive: true,
          apiQuota: -1,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
        {
          id: 3,
          username: 'root_admin',
          passwordHash: adminHash,
          email: 'root@example.com',
          createdIp: '127.0.0.1',
          role: 'admin',
          isActive: true,
          apiKey: 'admin-key',
          apiActive: true,
          apiQuota: 60,
          createdAt: new Date('2020-01-01T00:00:00Z'),
          updatedAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    })

    const app = createApplication({
      config: TEST_CONFIGURATION,
      usersRepository,
      linksRepository,
    })

    const basicSession = await authenticateSession(app, 'basic_user', 'user-pw')
    const basicDashboardHtml = await (
      await app.request('/admin', {
        headers: { Cookie: basicSession.sessionCookies },
      })
    ).text()
    expect(basicDashboardHtml).toContain('id="user_links_table"')
    expect(basicDashboardHtml).not.toContain('id="admin_links_table"')
    expect(basicDashboardHtml).not.toContain('id="developer"')

    const basicAboutHtml = await (
      await app.request('/about-polr', {
        headers: { Cookie: basicSession.sessionCookies },
      })
    ).text()
    expect(basicAboutHtml).not.toContain('Build Information')

    const devSession = await authenticateSession(app, 'dev_user', 'dev-pw')
    const devDashboardHtml = await (
      await app.request('/admin', {
        headers: { Cookie: devSession.sessionCookies },
      })
    ).text()
    expect(devDashboardHtml).toContain('id="developer"')
    expect(devDashboardHtml).toContain('dev-api-key-999')
    expect(devDashboardHtml).toContain('unlimited')
    expect(devDashboardHtml).not.toContain('id="admin_links_table"')

    const adminSession = await authenticateSession(app, 'root_admin', 'admin-pw')
    const adminDashboardHtml = await (
      await app.request('/admin', {
        headers: { Cookie: adminSession.sessionCookies },
      })
    ).text()
    expect(adminDashboardHtml).toContain('id="admin_links_table"')
    expect(adminDashboardHtml).toContain('id="admin_users_table"')

    const adminAboutHtml = await (
      await app.request('/about-polr', {
        headers: { Cookie: adminSession.sessionCookies },
      })
    ).text()
    expect(adminAboutHtml).toContain('Build Information')
    expect(adminAboutHtml).toContain('January 01, 2025')
    expect(adminAboutHtml).not.toContain('project.polr.me')

    const failedChange = await app.request('/admin/action/change_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': basicSession.sessionCookies,
      },
      body: new URLSearchParams({
        current_password: 'wrong-old-password',
        new_password: 'new-user-pw',
        _token: basicSession.csrfToken,
      }).toString(),
    })
    expect(failedChange.status).toBe(302)
    expect(await verifyPasswordWithBcrypt('user-pw', state.users[0]?.passwordHash ?? null)).toBe(true)

    const validChange = await app.request('/admin/action/change_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': basicSession.sessionCookies,
      },
      body: new URLSearchParams({
        current_password: 'user-pw',
        new_password: 'new-user-pw',
        _token: basicSession.csrfToken,
      }).toString(),
    })
    expect(validChange.status).toBe(302)
    expect(await verifyPasswordWithBcrypt('new-user-pw', state.users[0]?.passwordHash ?? null)).toBe(true)
  })
})
