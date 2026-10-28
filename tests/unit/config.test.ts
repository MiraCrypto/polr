import { describe, expect, it } from 'vitest'
import { loadApplicationConfiguration } from '../../src/config.js'
import { createPostgresClient } from '../../src/db/client.js'

const VALID_ENVIRONMENT: Record<string, string> = {
  PORT: '3000',
  HOST: '127.0.0.1',
  APP_NAME: 'Test Shortener',
  APP_PROTOCOL: 'https://',
  APP_ADDRESS: 'short.example.com',
  APP_KEY: 'secret-signing-key',
  DATABASE_URL: 'postgres://localhost:5432/shortener',
  POLR_BASE: '62',
  POLR_SECRET_BYTES: '2',
  _API_KEY_LENGTH: '15',
  SETTING_PUBLIC_INTERFACE: 'false',
  SETTING_SHORTEN_PERMISSION: 'false',
  SETTING_INDEX_REDIRECT: '',
  SETTING_REDIRECT_404: 'false',
  POLR_VERSION: '3.0.0',
  POLR_RELDATE: 'October 27, 2026',
  POLR_GENERATED_AT: 'January 01, 2025',
}

describe('application configuration loader', () => {
  it('parses a complete valid environment and trims surrounding whitespace', () => {
    const config = loadApplicationConfiguration({
      ...VALID_ENVIRONMENT,
      APP_NAME: '  Test Shortener  ',
      SETTING_PUBLIC_INTERFACE: '1',
      POLR_BASE: '32',
    })
    expect(config.appName).toBe('Test Shortener')
    expect(config.publicInterfaceEnabled).toBe(true)
    expect(config.polrBase).toBe(32)
    expect(config.port).toBe(3000)
  })

  it('throws when any required string environment variable is missing or whitespace', () => {
    const requiredKeys = [
      'HOST',
      'APP_NAME',
      'APP_PROTOCOL',
      'APP_ADDRESS',
      'APP_KEY',
      'DATABASE_URL',
      'POLR_VERSION',
      'POLR_RELDATE',
      'POLR_GENERATED_AT',
    ]

    for (const key of requiredKeys) {
      expect(() =>
        loadApplicationConfiguration({
          ...VALID_ENVIRONMENT,
          [key]: '   ',
        }),
      ).toThrow(`Missing required environment variable: ${key}`)
    }
  })

  it('rejects non-positive or non-numeric integer environment variables', () => {
    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        PORT: '0',
      }),
    ).toThrow(/Invalid positive integer for environment variable PORT/)

    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        POLR_SECRET_BYTES: '-2',
      }),
    ).toThrow(/Invalid positive integer for environment variable POLR_SECRET_BYTES/)

    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        _API_KEY_LENGTH: 'not-a-number',
      }),
    ).toThrow(/Invalid positive integer for environment variable _API_KEY_LENGTH/)
  })

  it('enforces POLR_BASE to be strictly 32 or 62', () => {
    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        POLR_BASE: '16',
      }),
    ).toThrow('Invalid POLR_BASE (must be 32 or 62): 16')
  })

  it('parses boolean strings strictly and rejects ambiguous values', () => {
    const configWithZeroAndOne = loadApplicationConfiguration({
      ...VALID_ENVIRONMENT,
      SETTING_PUBLIC_INTERFACE: '1',
      SETTING_SHORTEN_PERMISSION: '0',
    })
    expect(configWithZeroAndOne.publicInterfaceEnabled).toBe(true)
    expect(configWithZeroAndOne.shortenRequiresLogin).toBe(false)

    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        SETTING_PUBLIC_INTERFACE: 'yes',
      }),
    ).toThrow(/Invalid boolean for environment variable SETTING_PUBLIC_INTERFACE/)
  })

  it('requires SETTING_INDEX_REDIRECT when SETTING_REDIRECT_404 is enabled', () => {
    expect(() =>
      loadApplicationConfiguration({
        ...VALID_ENVIRONMENT,
        SETTING_REDIRECT_404: 'true',
        SETTING_INDEX_REDIRECT: '   ',
      }),
    ).toThrow('SETTING_INDEX_REDIRECT is required when SETTING_REDIRECT_404 is enabled')

    const validRedirectConfig = loadApplicationConfiguration({
      ...VALID_ENVIRONMENT,
      SETTING_REDIRECT_404: 'true',
      SETTING_INDEX_REDIRECT: 'https://example.com/landing',
    })
    expect(validRedirectConfig.redirectMissingLinksToIndex).toBe(true)
    expect(validRedirectConfig.indexRedirectUrl).toBe('https://example.com/landing')
  })

  it('decodes percent-encoded Unix domain socket paths in PostgreSQL connection URIs', async () => {
    const unixClient = createPostgresClient(
      'postgres://db_user:db_pass@%2Frun%2Fpostgresql/shortener_db',
      { max: 1 },
    )
    expect(unixClient.options.path).toBe('/run/postgresql/.s.PGSQL.5432')
    expect(unixClient.options.user).toBe('db_user')
    expect(unixClient.options.database).toBe('shortener_db')
    await unixClient.end({ timeout: 0 })

    const tcpClient = createPostgresClient(
      'postgres://db_user:db_pass@127.0.0.1:5433/shortener_db',
      { max: 1 },
    )
    expect(tcpClient.options.host).toEqual(['127.0.0.1'])
    expect(tcpClient.options.port).toEqual([5433])
    expect(tcpClient.options.database).toBe('shortener_db')
    await tcpClient.end({ timeout: 0 })
  })
})
