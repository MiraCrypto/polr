import type { Hono } from 'hono'
import type { ApplicationConfiguration } from '../src/config.js'

export const TEST_CONFIGURATION: ApplicationConfiguration = {
  port: 3000,
  host: '127.0.0.1',
  appName: 'Test Shortener',
  appProtocol: 'https://',
  appAddress: 'short.example.com',
  appKey: 'test-signing-secret-key-0123456789abcdef',
  databaseUrl: 'postgres://localhost:5432/test_shortener',
  polrBase: 62,
  polrSecretBytes: 2,
  apiKeyByteLength: 15,
  publicInterfaceEnabled: false,
  shortenRequiresLogin: false,
  indexRedirectUrl: '',
  redirectMissingLinksToIndex: false,
  polrVersion: '3.0.0',
  polrReleaseDate: 'October 27, 2026',
  polrGeneratedAt: 'January 01, 2025',
}

export function extractCookiesFromResponse(response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie()
  return setCookieHeaders
    .map(header => header.split(';')[0] ?? '')
    .filter(pair => pair.length > 0)
    .join('; ')
}

export function extractCsrfTokenFromHtml(html: string): string {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)">/)
  return match?.[1] ?? ''
}

export async function authenticateSession(
  app: Hono,
  username: string,
  password: string,
): Promise<{ readonly sessionCookies: string, readonly csrfToken: string }> {
  const loginPageResponse = await app.request('/login')
  const loginHtml = await loginPageResponse.text()
  const anonymousCsrf = extractCsrfTokenFromHtml(loginHtml)
  const anonymousCookies = extractCookiesFromResponse(loginPageResponse)

  const loginPostResponse = await app.request('/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': anonymousCookies,
    },
    body: new URLSearchParams({
      username,
      password,
      _token: anonymousCsrf,
    }).toString(),
  })

  const sessionCookies = extractCookiesFromResponse(loginPostResponse)
  const dashboardResponse = await app.request('/admin', {
    headers: { Cookie: sessionCookies },
  })
  const dashboardHtml = await dashboardResponse.text()
  const csrfToken = extractCsrfTokenFromHtml(dashboardHtml)

  return { sessionCookies, csrfToken }
}
