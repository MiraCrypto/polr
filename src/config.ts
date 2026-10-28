export interface ApplicationConfiguration {
  readonly port: number
  readonly host: string
  readonly appName: string
  readonly appProtocol: string
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
  readonly polrGeneratedAt: string
}

function requireNonEmptyString(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const rawValue = environmentVariables[variableName]
  if (rawValue === undefined || rawValue.trim() === '') {
    throw new Error(`Missing required environment variable: ${variableName}`)
  }
  return rawValue.trim()
}

function requirePositiveInteger(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
): number {
  const rawValue = requireNonEmptyString(environmentVariables, variableName)
  const parsedNumber = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
    throw new Error(`Invalid positive integer for environment variable ${variableName}: ${rawValue}`)
  }
  return parsedNumber
}

function requireBoolean(
  environmentVariables: NodeJS.ProcessEnv,
  variableName: string,
): boolean {
  const rawValue = requireNonEmptyString(environmentVariables, variableName).toLowerCase()
  if (rawValue === 'true' || rawValue === '1') {
    return true
  }
  if (rawValue === 'false' || rawValue === '0') {
    return false
  }
  throw new Error(`Invalid boolean for environment variable ${variableName}: ${rawValue}`)
}

export function loadApplicationConfiguration(
  environmentVariables: NodeJS.ProcessEnv = process.env,
): ApplicationConfiguration {
  const rawBase = requirePositiveInteger(environmentVariables, 'POLR_BASE')
  if (rawBase !== 32 && rawBase !== 62) {
    throw new Error(`Invalid POLR_BASE (must be 32 or 62): ${rawBase}`)
  }

  const publicInterfaceEnabled = requireBoolean(environmentVariables, 'SETTING_PUBLIC_INTERFACE')
  const redirectMissingLinksToIndex = requireBoolean(environmentVariables, 'SETTING_REDIRECT_404')
  const indexRedirectUrl = (environmentVariables['SETTING_INDEX_REDIRECT'] ?? '').trim()

  if (redirectMissingLinksToIndex && indexRedirectUrl === '') {
    throw new Error('SETTING_INDEX_REDIRECT is required when SETTING_REDIRECT_404 is enabled')
  }

  return {
    port: requirePositiveInteger(environmentVariables, 'PORT'),
    host: requireNonEmptyString(environmentVariables, 'HOST'),
    appName: requireNonEmptyString(environmentVariables, 'APP_NAME'),
    appProtocol: requireNonEmptyString(environmentVariables, 'APP_PROTOCOL'),
    appAddress: requireNonEmptyString(environmentVariables, 'APP_ADDRESS'),
    appKey: requireNonEmptyString(environmentVariables, 'APP_KEY'),
    databaseUrl: requireNonEmptyString(environmentVariables, 'DATABASE_URL'),
    polrBase: rawBase,
    polrSecretBytes: requirePositiveInteger(environmentVariables, 'POLR_SECRET_BYTES'),
    apiKeyByteLength: requirePositiveInteger(environmentVariables, '_API_KEY_LENGTH'),
    publicInterfaceEnabled,
    shortenRequiresLogin: requireBoolean(environmentVariables, 'SETTING_SHORTEN_PERMISSION'),
    indexRedirectUrl,
    redirectMissingLinksToIndex,
    polrVersion: requireNonEmptyString(environmentVariables, 'POLR_VERSION'),
    polrReleaseDate: requireNonEmptyString(environmentVariables, 'POLR_RELDATE'),
    polrGeneratedAt: requireNonEmptyString(environmentVariables, 'POLR_GENERATED_AT'),
  }
}
