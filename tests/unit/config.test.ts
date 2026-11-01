import { describe, expect, it } from 'vitest'
import { loadApplicationConfiguration, loadOptionalEnvFile } from '../../src/config.js'
import { createPostgresClient, formatSubstringLikePattern } from '../../src/db/client.js'

const MINIMAL_REQUIRED_ENVIRONMENT: Record<string, string> = {
  APP_NAME: 'Test Shortener',
  APP_PROTOCOL: 'https://',
  APP_ADDRESS: 'short.example.com',
  APP_KEY: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgres://localhost:5432/shortener',
}

describe('application configuration loader', () => {
  it('loads with only required deployment variables and applies standard defaults', () => {
    const config = loadApplicationConfiguration({
      ...MINIMAL_REQUIRED_ENVIRONMENT,
      APP_NAME: '  Test Shortener  ',
    })

    expect(config.appName).toBe('Test Shortener')
    expect(config.appProtocol).toBe('https://')
    expect(config.port).toBe(3000)
    expect(config.host).toBe('127.0.0.1')
    expect(config.polrBase).toBe(62)
    expect(config.polrSecretBytes).toBe(2)
    expect(config.apiKeyByteLength).toBe(15)
    expect(config.publicInterfaceEnabled).toBe(true)
    expect(config.shortenRequiresLogin).toBe(false)
    expect(config.redirectMissingLinksToIndex).toBe(false)
    expect(config.indexRedirectUrl).toBe('')
    expect(config.polrVersion).toBe('3.0.0')
    expect(config.polrGeneratedAt).toBeNull()

    const warnings: string[] = []
    const loadedMissing = loadOptionalEnvFile('.env.nonexistent-test-file', (msg) => {
      warnings.push(msg)
    })
    expect(loadedMissing).toBe(false)
    expect(warnings).toEqual([
      'Environment file \'.env.nonexistent-test-file\' not found.',
    ])
  })

  it('throws when any required deployment variable is missing or whitespace', () => {
    const requiredKeys = [
      'APP_NAME',
      'APP_PROTOCOL',
      'APP_ADDRESS',
      'APP_KEY',
      'DATABASE_URL',
    ]

    for (const key of requiredKeys) {
      expect(() =>
        loadApplicationConfiguration({
          ...MINIMAL_REQUIRED_ENVIRONMENT,
          [key]: '   ',
        }),
      ).toThrow(`Missing required environment variable: ${key}`)
    }
  })

  it('rejects example placeholder APP_KEY values and invalid APP_PROTOCOL schemes', () => {
    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        APP_KEY: 'replace-with-random-32-byte-secret-key',
      }),
    ).toThrow(/APP_KEY must be replaced with a secret key instead of the example placeholder/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        APP_PROTOCOL: 'https',
      }),
    ).toThrow(/Invalid APP_PROTOCOL/)
  })

  it('validates optional integer overrides', () => {
    const overridden = loadApplicationConfiguration({
      ...MINIMAL_REQUIRED_ENVIRONMENT,
      PORT: '8080',
      POLR_BASE: '32',
      _API_KEY_LENGTH: '18',
    })
    expect(overridden.port).toBe(8080)
    expect(overridden.polrBase).toBe(32)
    expect(overridden.apiKeyByteLength).toBe(18)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        PORT: '0',
      }),
    ).toThrow(/Invalid positive integer for environment variable PORT/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        PORT: '70000',
      }),
    ).toThrow(/Invalid PORT/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        PORT: '3000px',
      }),
    ).toThrow(/Invalid positive integer for environment variable PORT/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        POLR_SECRET_BYTES: '-2',
      }),
    ).toThrow(/Invalid positive integer for environment variable POLR_SECRET_BYTES/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        POLR_BASE: '16',
      }),
    ).toThrow('Invalid POLR_BASE (must be 32 or 62): 16')
  })

  it('parses boolean strings strictly and requires SETTING_INDEX_REDIRECT when SETTING_REDIRECT_404 is enabled', () => {
    const configWithZeroAndOne = loadApplicationConfiguration({
      ...MINIMAL_REQUIRED_ENVIRONMENT,
      SETTING_PUBLIC_INTERFACE: '0',
      SETTING_SHORTEN_PERMISSION: '1',
    })
    expect(configWithZeroAndOne.publicInterfaceEnabled).toBe(false)
    expect(configWithZeroAndOne.shortenRequiresLogin).toBe(true)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        SETTING_PUBLIC_INTERFACE: 'yes',
      }),
    ).toThrow(/Invalid boolean for environment variable SETTING_PUBLIC_INTERFACE/)

    expect(() =>
      loadApplicationConfiguration({
        ...MINIMAL_REQUIRED_ENVIRONMENT,
        SETTING_REDIRECT_404: 'true',
        SETTING_INDEX_REDIRECT: '   ',
      }),
    ).toThrow('SETTING_INDEX_REDIRECT is required when SETTING_REDIRECT_404 is enabled')
  })

  it('normalizes Unix domain socket PostgreSQL URIs and escapes ILIKE wildcards', async () => {
    const encodedAuthorityClient = createPostgresClient(
      'postgres://db_user:db_pass@%2Frun%2Fpostgresql/shortener_db',
      { max: 1 },
    )
    expect(encodedAuthorityClient.options.path).toBe('/run/postgresql/.s.PGSQL.5432')
    expect(encodedAuthorityClient.options.user).toBe('db_user')
    expect(encodedAuthorityClient.options.database).toBe('shortener_db')
    await encodedAuthorityClient.end({ timeout: 0 })

    const libpqQuerySocketClient = createPostgresClient(
      'postgres:///shortener_db?host=/var/run/postgresql',
      { max: 1 },
    )
    expect(libpqQuerySocketClient.options.path).toBe('/var/run/postgresql/.s.PGSQL.5432')
    expect(libpqQuerySocketClient.options.database).toBe('shortener_db')
    await libpqQuerySocketClient.end({ timeout: 0 })

    const tcpClient = createPostgresClient(
      'postgres://db_user:db_pass@127.0.0.1:5433/shortener_db',
      { max: 1 },
    )
    expect(tcpClient.options.host).toEqual(['127.0.0.1'])
    expect(tcpClient.options.port).toEqual([5433])
    expect(tcpClient.options.database).toBe('shortener_db')
    await tcpClient.end({ timeout: 0 })

    expect(formatSubstringLikePattern('my_slug%100\\test')).toBe('%my\\_slug\\%100\\\\test%')
  })
})
