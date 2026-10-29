import type { Options, Sql } from 'postgres'
import postgres from 'postgres'

const DEFAULT_POSTGRES_PORT = 5432
const DEFAULT_POSTGRES_DATABASE = 'postgres'

export function formatSubstringLikePattern(rawSearchTerm: string): string {
  const escapedTerm = rawSearchTerm.replace(/[\\%_]/g, '\\$&')
  return `%${escapedTerm}%`
}

// postgres.js misparses Unix domain socket URIs: parseUrl fails to strip percent-encoded
// authority hosts (%2Frun%2Fpostgresql) and ignores libpq's ?host=/path query parameter.
export function createPostgresClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Sql {
  try {
    const parsedUrl = new URL(databaseUrl)
    const lowerHostname = parsedUrl.hostname.toLowerCase()
    const authoritySocketPath = (lowerHostname.startsWith('%2f') || parsedUrl.hostname.includes('/'))
      ? decodeURIComponent(parsedUrl.hostname)
      : null
    const queryHost = parsedUrl.searchParams.get('host')
    const querySocketPath = queryHost !== null && queryHost.startsWith('/')
      ? queryHost
      : null
    const socketDirectory = authoritySocketPath ?? querySocketPath

    if (socketDirectory !== null) {
      const port = parsedUrl.port.length > 0
        ? Number(parsedUrl.port)
        : DEFAULT_POSTGRES_PORT
      const database = parsedUrl.pathname.length > 1
        ? decodeURIComponent(parsedUrl.pathname.slice(1))
        : DEFAULT_POSTGRES_DATABASE

      return postgres({
        ...options,
        host: socketDirectory,
        port,
        user: decodeURIComponent(parsedUrl.username),
        pass: decodeURIComponent(parsedUrl.password),
        database,
      })
    }
  }
  catch {
    // Delegate non-URL connection strings directly to postgres.js
  }
  return postgres(databaseUrl, options)
}
