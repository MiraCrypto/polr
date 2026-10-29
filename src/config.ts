const DEFAULT_HTTP_PORT = 3000
const DEFAULT_BIND_HOST = '127.0.0.1'
const DEFAULT_POLR_BASE = 62
const DEFAULT_SECRET_BYTE_LENGTH = 2
const DEFAULT_API_KEY_BYTE_LENGTH = 15
const DEFAULT_POLR_VERSION = '3.0.0'
const DEFAULT_POLR_RELEASE_DATE = 'October 27, 2026'
const PLACEHOLDER_APP_KEY = 'replace-with-random-32-byte-secret-key'
const MAXIMUM_TCP_PORT = 65535

export interface ApplicationConfiguration {
  readonly port: number
  readonly host: string
  readonly appName: string
  readonly appProtocol: 'http://' | 'https://'
  readonly appAddress: string
  readonly appKey: string
  readonly databaseUrl: string
  readonly polrBase: 32 | 62
  readonly polrSecretBytes: number
  readonly apiKeyByteLength: number
  readonly publicInterfaceEnabled: boolean
  readonly shortenRequiresLogin: boolean
  readonly indexRedirectUrl: string
  readonly redirectMissingLinksToIndex: boolean
  readonly polrVersion: string
  readonly polrReleaseDate: string
  readonly polrGeneratedAt: string | null
}

function readOptionalString(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
): string | null {
  const rawValue = environmentVariables[variableName]
  if (rawValue === undefined) {
    return null
  }
  const trimmed = rawValue.trim()
  return trimmed.length > 0
    ? trimmed
    : null
}

function requireNonEmptyString(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const value = readOptionalString(environmentVariables, variableName)
  if (value === null) {
    throw new Error(`Missing required environment variable: ${variableName}`)
  }
  return value
}

function parseOptionalPositiveInteger(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: number,
): number {
  const rawValue = readOptionalString(environmentVariables, variableName)
  if (rawValue === null) {
    return defaultValue
  }
  const parsedNumber = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0 || String(parsedNumber) !== rawValue) {
    throw new Error(`Invalid positive integer for environment variable ${variableName}: ${rawValue}`)
  }
  return parsedNumber
}

function parseOptionalBoolean(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: boolean,
): boolean {
  const rawValue = readOptionalString(environmentVariables, variableName)
  if (rawValue === null) {
    return defaultValue
  }
  const normalized = rawValue.toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  throw new Error(`Invalid boolean for environment variable ${variableName}: ${rawValue}`)
}

function requireAppProtocol(environmentVariables: NodeJS.ProcessEnv): 'http://' | 'https://' {
  const rawProtocol = requireNonEmptyString(environmentVariables, 'APP_PROTOCOL').toLowerCase()
  if (rawProtocol !== 'http://' && rawProtocol !== 'https://') {
    throw new Error(`Invalid APP_PROTOCOL (must be 'http://' or 'https://'): ${rawProtocol}`)
  }
  return rawProtocol
}

function requireSigningAppKey(environmentVariables: NodeJS.ProcessEnv): string {
  const appKey = requireNonEmptyString(environmentVariables, 'APP_KEY')
  if (appKey === PLACEHOLDER_APP_KEY) {
    throw new Error('APP_KEY must be replaced with a secret key instead of the example placeholder')
  }
  return appKey
}

export function loadApplicationConfiguration(
  environmentVariables: NodeJS.ProcessEnv = process.env,
): ApplicationConfiguration {
  const port = parseOptionalPositiveInteger(environmentVariables, 'PORT', DEFAULT_HTTP_PORT)
  if (port > MAXIMUM_TCP_PORT) {
    throw new Error(`Invalid PORT (must be <= ${MAXIMUM_TCP_PORT}): ${port}`)
  }

  const rawBase = parseOptionalPositiveInteger(environmentVariables, 'POLR_BASE', DEFAULT_POLR_BASE)
  if (rawBase !== 32 && rawBase !== 62) {
    throw new Error(`Invalid POLR_BASE (must be 32 or 62): ${rawBase}`)
  }

  const publicInterfaceEnabled = parseOptionalBoolean(
    environmentVariables,
    'SETTING_PUBLIC_INTERFACE',
    true,
  )
  const redirectMissingLinksToIndex = parseOptionalBoolean(
    environmentVariables,
    'SETTING_REDIRECT_404',
    false,
  )
  const indexRedirectUrl = readOptionalString(environmentVariables, 'SETTING_INDEX_REDIRECT') ?? ''

  if (redirectMissingLinksToIndex && indexRedirectUrl.length === 0) {
    throw new Error('SETTING_INDEX_REDIRECT is required when SETTING_REDIRECT_404 is enabled')
  }

  return {
    port,
    host: readOptionalString(environmentVariables, 'HOST') ?? DEFAULT_BIND_HOST,
    appName: requireNonEmptyString(environmentVariables, 'APP_NAME'),
    appProtocol: requireAppProtocol(environmentVariables),
    appAddress: requireNonEmptyString(environmentVariables, 'APP_ADDRESS'),
    appKey: requireSigningAppKey(environmentVariables),
    databaseUrl: requireNonEmptyString(environmentVariables, 'DATABASE_URL'),
    polrBase: rawBase,
    polrSecretBytes: parseOptionalPositiveInteger(
      environmentVariables,
      'POLR_SECRET_BYTES',
      DEFAULT_SECRET_BYTE_LENGTH,
    ),
    apiKeyByteLength: parseOptionalPositiveInteger(
      environmentVariables,
      '_API_KEY_LENGTH',
      DEFAULT_API_KEY_BYTE_LENGTH,
    ),
    publicInterfaceEnabled,
    shortenRequiresLogin: parseOptionalBoolean(
      environmentVariables,
      'SETTING_SHORTEN_PERMISSION',
      false,
    ),
    indexRedirectUrl,
    redirectMissingLinksToIndex,
    polrVersion: readOptionalString(environmentVariables, 'POLR_VERSION') ?? DEFAULT_POLR_VERSION,
    polrReleaseDate: readOptionalString(environmentVariables, 'POLR_RELDATE') ?? DEFAULT_POLR_RELEASE_DATE,
    polrGeneratedAt: readOptionalString(environmentVariables, 'POLR_GENERATED_AT'),
  }
}
