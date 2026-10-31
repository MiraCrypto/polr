import { readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createPostgresClient } from '../../src/db/client.js'

type MigrationUserRole = 'user' | 'admin'

export interface LegacyMysqlUserRow {
  readonly id: number | string
  readonly username?: string | null
  readonly password?: string | null
  readonly email?: string | null
  readonly ip?: string | null
  readonly role?: string | null
  readonly active?: string | number | null
  readonly api_key?: string | null
  readonly api_active?: string | number | null
  readonly api_quota?: string | number | null
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export interface LegacyMysqlLinkRow {
  readonly id: number | string
  readonly short_url?: string | null
  readonly long_url?: string | null
  readonly ip?: string | null
  readonly creator?: string | null
  readonly clicks?: string | number | null
  readonly secret_key?: string | null
  readonly is_disabled?: string | number | null
  readonly is_custom?: string | number | null
  readonly is_api?: string | number | null
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export interface LegacyDumpPayload {
  readonly users: readonly LegacyMysqlUserRow[]
  readonly links: readonly LegacyMysqlLinkRow[]
}

export interface NormalizedMigrationUser {
  readonly id: number
  readonly username: string
  readonly passwordHash: string | null
  readonly email: string | null
  readonly createdIp: string | null
  readonly role: MigrationUserRole
  readonly isActive: boolean
  readonly apiKey: string | null
  readonly apiActive: boolean
  readonly apiQuota: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface NormalizedMigrationLink {
  readonly id: number
  readonly shortUrl: string
  readonly longUrl: string
  readonly createdIp: string
  readonly creatorId: number | null
  readonly clicks: number
  readonly secretKey: string | null
  readonly isDisabled: boolean
  readonly isCustom: boolean
  readonly isApi: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface NormalizedMigrationPlan {
  readonly users: readonly NormalizedMigrationUser[]
  readonly links: readonly NormalizedMigrationLink[]
  readonly skippedUsersCount: number
  readonly skippedLinksCount: number
  readonly nextCounterSequenceValue: number
}

const BASE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const VALID_IDENTIFIER_PATTERN = /^[\w-]+$/
const MAXIMUM_LONG_URL_LENGTH = 65535
const DEFAULT_FALLBACK_MIGRATION_TIMESTAMP = '1970-01-01T00:00:00Z'
const DEFAULT_FALLBACK_API_QUOTA = 60
const DEFAULT_FALLBACK_LINK_IP = '127.0.0.1'
const DATABASE_CLOSE_TIMEOUT_SECONDS = 5
const DEFAULT_SCHEMA_SQL_FILE_PATH = fileURLToPath(
  new URL('../../src/db/schema.sql', import.meta.url),
)

const RESERVED_ROUTE_ENDINGS = new Set([
  'admin',
  'login',
  'logout',
  'shorten',
  'about-polr',
  'api',
  'css',
  'js',
  'img',
  'fonts',
  'directives',
  'favicon.ico',
  'setup',
  'signup',
  'lost_password',
  'reset_password',
  'activate',
])

function stripNullBytesAndTrim(value: string | null | undefined): string {
  return (value ?? '').replaceAll('\0', '').trim()
}

function parseTruthyLegacyFlag(value: string | number | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function parseMysqlTimestamp(rawTimestamp: string | null | undefined, fallbackDate: Date): Date {
  const trimmed = stripNullBytesAndTrim(rawTimestamp)
  if (trimmed.length === 0 || trimmed.startsWith('0000-00-00')) {
    return fallbackDate
  }
  const isoString = trimmed.includes('T')
    ? trimmed
    : `${trimmed.replace(' ', 'T')}Z`
  const parsed = new Date(isoString)
  return Number.isNaN(parsed.getTime())
    ? fallbackDate
    : parsed
}

function decodeBaseCounter(encodedValue: string, radix: 32 | 62): number | null {
  if (encodedValue.length === 0) {
    return null
  }

  let decodedNumber = 0
  for (let index = 0; index < encodedValue.length; index += 1) {
    const character = encodedValue[index] ?? ''
    const digitValue = BASE_ALPHABET.indexOf(character)
    if (digitValue === -1 || digitValue >= radix) {
      return null
    }
    decodedNumber = radix * decodedNumber + digitValue
  }

  return Number.isSafeInteger(decodedNumber)
    ? decodedNumber
    : null
}

export function calculateNextCounterSequenceValue(
  links: readonly NormalizedMigrationLink[],
): number {
  let maxCounterValue = -1

  for (const link of links) {
    if (link.isCustom) {
      continue
    }
    for (const radix of [32, 62] as const) {
      const decodedValue = decodeBaseCounter(link.shortUrl, radix)
      if (decodedValue !== null && decodedValue > maxCounterValue) {
        maxCounterValue = decodedValue
      }
    }
  }

  return maxCounterValue + 1
}

export function normalizeLegacyDumpForPostgres(dump: LegacyDumpPayload): NormalizedMigrationPlan {
  const defaultFallbackDate = new Date(DEFAULT_FALLBACK_MIGRATION_TIMESTAMP)
  const earliestLinkDateByCreator = new Map<string, Date>()

  for (const rawLink of dump.links) {
    const creator = stripNullBytesAndTrim(rawLink.creator)
    if (creator.length === 0) {
      continue
    }
    const linkCreatedAt = parseMysqlTimestamp(rawLink.created_at, defaultFallbackDate)
    const existingEarliest = earliestLinkDateByCreator.get(creator)
    if (existingEarliest === undefined || linkCreatedAt < existingEarliest) {
      earliestLinkDateByCreator.set(creator, linkCreatedAt)
    }
  }

  const normalizedUsers: NormalizedMigrationUser[] = []
  const userIdByUsername = new Map<string, number>()
  const seenApiKeys = new Set<string>()
  let skippedUsersCount = 0

  for (const rawUser of dump.users) {
    const id = Number.parseInt(String(rawUser.id), 10)
    const username = stripNullBytesAndTrim(rawUser.username)
    if (
      !Number.isInteger(id)
      || id <= 0
      || !VALID_IDENTIFIER_PATTERN.test(username)
      || userIdByUsername.has(username)
    ) {
      skippedUsersCount += 1
      continue
    }

    const updatedAt = parseMysqlTimestamp(rawUser.updated_at, defaultFallbackDate)
    const earliestLinkDate = earliestLinkDateByCreator.get(username) ?? updatedAt
    const createdAt = parseMysqlTimestamp(rawUser.created_at, earliestLinkDate)

    const trimmedIp = stripNullBytesAndTrim(rawUser.ip)
    const createdIp = trimmedIp.length > 0 && isIP(trimmedIp) !== 0
      ? trimmedIp
      : null
    const trimmedPassword = stripNullBytesAndTrim(rawUser.password)
    const trimmedEmail = stripNullBytesAndTrim(rawUser.email)
    const rawApiKey = stripNullBytesAndTrim(rawUser.api_key)
    let apiKey: string | null = null
    if (rawApiKey.length > 0 && !seenApiKeys.has(rawApiKey)) {
      apiKey = rawApiKey
      seenApiKeys.add(rawApiKey)
    }

    const parsedQuota = Number.parseInt(String(rawUser.api_quota ?? ''), 10)
    const normalizedQuota = Number.isNaN(parsedQuota)
      ? DEFAULT_FALLBACK_API_QUOTA
      : Math.max(-1, parsedQuota)

    normalizedUsers.push({
      id,
      username,
      passwordHash: trimmedPassword.length > 0
        ? trimmedPassword
        : null,
      email: trimmedEmail.length > 0
        ? trimmedEmail
        : null,
      createdIp,
      role: stripNullBytesAndTrim(rawUser.role) === 'admin'
        ? 'admin'
        : 'user',
      isActive: parseTruthyLegacyFlag(rawUser.active),
      apiKey,
      apiActive: parseTruthyLegacyFlag(rawUser.api_active),
      apiQuota: normalizedQuota,
      createdAt,
      updatedAt,
    })
    userIdByUsername.set(username, id)
  }

  const normalizedLinks: NormalizedMigrationLink[] = []
  const seenShortUrls = new Set<string>()
  let skippedLinksCount = 0

  for (const rawLink of dump.links) {
    const id = Number.parseInt(String(rawLink.id), 10)
    const shortUrl = stripNullBytesAndTrim(rawLink.short_url)
    const longUrl = (rawLink.long_url ?? '').replaceAll('\0', '')
    const isCustom = parseTruthyLegacyFlag(rawLink.is_custom)

    if (
      !Number.isInteger(id)
      || id <= 0
      || !VALID_IDENTIFIER_PATTERN.test(shortUrl)
      || seenShortUrls.has(shortUrl)
      || longUrl.length === 0
      || longUrl.length > MAXIMUM_LONG_URL_LENGTH
      || (isCustom && RESERVED_ROUTE_ENDINGS.has(shortUrl.toLowerCase()))
    ) {
      skippedLinksCount += 1
      continue
    }

    seenShortUrls.add(shortUrl)

    const trimmedIp = stripNullBytesAndTrim(rawLink.ip)
    const createdIp = trimmedIp.length > 0 && isIP(trimmedIp) !== 0
      ? trimmedIp
      : DEFAULT_FALLBACK_LINK_IP
    const creatorUsername = stripNullBytesAndTrim(rawLink.creator)
    const creatorId = creatorUsername.length > 0
      ? (userIdByUsername.get(creatorUsername) ?? null)
      : null
    const trimmedSecretKey = stripNullBytesAndTrim(rawLink.secret_key)
    const parsedClicks = Number.parseInt(String(rawLink.clicks ?? '0'), 10)
    const clicks = Number.isNaN(parsedClicks)
      ? 0
      : Math.max(0, parsedClicks)
    const createdAt = parseMysqlTimestamp(rawLink.created_at, defaultFallbackDate)
    const updatedAt = parseMysqlTimestamp(rawLink.updated_at, createdAt)

    normalizedLinks.push({
      id,
      shortUrl,
      longUrl,
      createdIp,
      creatorId,
      clicks,
      secretKey: trimmedSecretKey.length > 0
        ? trimmedSecretKey
        : null,
      isDisabled: parseTruthyLegacyFlag(rawLink.is_disabled),
      isCustom,
      isApi: parseTruthyLegacyFlag(rawLink.is_api),
      createdAt,
      updatedAt,
    })
  }

  return {
    users: normalizedUsers,
    links: normalizedLinks,
    skippedUsersCount,
    skippedLinksCount,
    nextCounterSequenceValue: calculateNextCounterSequenceValue(normalizedLinks),
  }
}

export async function executePostgresMigration(
  databaseUrl: string,
  dumpFilePath: string,
  schemaFilePath: string = DEFAULT_SCHEMA_SQL_FILE_PATH,
): Promise<NormalizedMigrationPlan> {
  const rawDumpContent = await readFile(dumpFilePath, 'utf8')
  const parsedJson: unknown = JSON.parse(rawDumpContent)
  if (
    typeof parsedJson !== 'object'
    || parsedJson === null
    || !Array.isArray((parsedJson as Record<string, unknown>)['users'])
    || !Array.isArray((parsedJson as Record<string, unknown>)['links'])
  ) {
    throw new Error('Invalid dump JSON: expected top-level "users" and "links" arrays.')
  }

  const plan = normalizeLegacyDumpForPostgres(parsedJson as LegacyDumpPayload)
  const sql = createPostgresClient(databaseUrl, { max: 1, connect_timeout: 10, prepare: false })

  try {
    await sql.begin(async (transaction) => {
      const existingSchemaRows = await transaction<Array<{ readonly table_name: string | null }>>`
        SELECT to_regclass('public.users')::text AS table_name
      `
      if (existingSchemaRows[0]?.table_name === null) {
        const schemaSql = await readFile(schemaFilePath, 'utf8')
        await transaction.unsafe(schemaSql)
      }
      else {
        const countRows = await transaction<Array<{
          readonly user_count: number
          readonly link_count: number
        }>>`
          SELECT
            (SELECT COUNT(*)::int FROM users) AS user_count,
            (SELECT COUNT(*)::int FROM links) AS link_count
        `
        const existingUsers = countRows[0]?.user_count ?? 0
        const existingLinks = countRows[0]?.link_count ?? 0
        if (existingUsers > 0 || existingLinks > 0) {
          throw new Error(
            `Refusing to import into non-empty target tables (users=${existingUsers}, links=${existingLinks}).`,
          )
        }
      }

      for (const user of plan.users) {
        await transaction`
          INSERT INTO users (
            id, username, password_hash, email, created_ip, role, is_active, api_key, api_active, api_quota, created_at, updated_at
          ) VALUES (
            ${user.id},
            ${user.username},
            ${user.passwordHash},
            ${user.email},
            ${user.createdIp},
            ${user.role},
            ${user.isActive},
            ${user.apiKey},
            ${user.apiActive},
            ${user.apiQuota},
            ${user.createdAt.toISOString()},
            ${user.updatedAt.toISOString()}
          )
        `
      }

      for (const link of plan.links) {
        await transaction`
          INSERT INTO links (
            id, short_url, long_url, created_ip, creator_id, clicks, secret_key, is_disabled, is_custom, is_api, created_at, updated_at
          ) VALUES (
            ${link.id},
            ${link.shortUrl},
            ${link.longUrl},
            ${link.createdIp},
            ${link.creatorId},
            ${link.clicks},
            ${link.secretKey},
            ${link.isDisabled},
            ${link.isCustom},
            ${link.isApi},
            ${link.createdAt.toISOString()},
            ${link.updatedAt.toISOString()}
          )
        `
      }

      await transaction`
        SELECT setval(
          pg_get_serial_sequence('users', 'id'),
          COALESCE((SELECT MAX(id) FROM users) + 1, 1),
          false
        )
      `
      await transaction`
        SELECT setval(
          pg_get_serial_sequence('links', 'id'),
          COALESCE((SELECT MAX(id) FROM links) + 1, 1),
          false
        )
      `
      await transaction`
        SELECT setval('link_counter_seq', ${plan.nextCounterSequenceValue}, false)
      `
    })

    return plan
  }
  finally {
    await sql.end({ timeout: DATABASE_CLOSE_TIMEOUT_SECONDS })
  }
}

async function runCli(): Promise<void> {
  const [dumpFilePath, schemaFilePath] = process.argv.slice(2)
  const databaseUrl = process.env['DATABASE_URL']?.trim() ?? ''

  if (databaseUrl.length === 0) {
    console.error('Missing required environment variable: DATABASE_URL')
    process.exitCode = 1
    return
  }

  if (dumpFilePath === undefined || dumpFilePath.trim().length === 0) {
    console.error(
      'Usage: DATABASE_URL=\'postgres://...\' node scripts/legacy-migration/import-postgres.ts <legacy-dump.json> [schema.sql]',
    )
    process.exitCode = 1
    return
  }

  const plan = await executePostgresMigration(
    databaseUrl,
    dumpFilePath.trim(),
    schemaFilePath?.trim() || DEFAULT_SCHEMA_SQL_FILE_PATH,
  )
  process.stdout.write(
    `Migrated ${plan.users.length} users (skipped ${plan.skippedUsersCount}) and ${plan.links.length} links (skipped ${plan.skippedLinksCount}); next counter sequence=${plan.nextCounterSequenceValue}.\n`,
  )
}

if (import.meta.main) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : String(error)
    console.error(`Error: ${message}`)
    process.exitCode = 1
  })
}
