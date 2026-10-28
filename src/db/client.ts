import type { Options, Sql } from 'postgres'
import postgres from 'postgres'

const DEFAULT_POSTGRES_PORT = 5432
const DEFAULT_POSTGRES_DATABASE = 'postgres'

export function createPostgresClient(
  databaseUrl: string,
  options: Options<Record<string, never>> = {},
): Sql {
  try {
    const parsedUrl = new URL(databaseUrl)
    if (parsedUrl.hostname.startsWith('%2F') || parsedUrl.hostname.includes('/')) {
      const socketDirectory = decodeURIComponent(parsedUrl.hostname)
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
    // Allow postgres.js to handle non-URL connection strings directly
  }
  return postgres(databaseUrl, options)
}
