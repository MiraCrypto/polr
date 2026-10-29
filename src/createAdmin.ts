import type { UsersRepository } from './db/repositories.js'
import type { UserRecord } from './domain/types.js'
import { text } from 'node:stream/consumers'
import { createPostgresClient } from './db/client.js'
import { createPostgresUsersRepository } from './db/usersRepository.js'
import { hashPasswordWithBcrypt } from './domain/authService.js'
import { isValidEndingSyntax } from './domain/linkService.js'

const DEFAULT_ADMIN_API_QUOTA = 60

export interface EnsureAdministratorInput {
  readonly username: string
  readonly password: string
  readonly email?: string | null
}

export interface EnsureAdministratorOutcome {
  readonly status: 'created' | 'updated'
  readonly user: UserRecord
}

export async function ensureAdministratorAccount(
  usersRepository: UsersRepository,
  input: EnsureAdministratorInput,
): Promise<EnsureAdministratorOutcome> {
  const username = input.username.trim()
  if (!isValidEndingSyntax(username)) {
    throw new Error(
      'Invalid username: may only contain alphanumeric characters, hyphens, and underscores.',
    )
  }

  if (input.password.length === 0) {
    throw new Error('Password must not be empty.')
  }

  const trimmedEmail = input.email?.trim() ?? ''
  const normalizedEmail = trimmedEmail.length > 0
    ? trimmedEmail
    : null
  const passwordHash = await hashPasswordWithBcrypt(input.password)

  const existingUser = await usersRepository.findByUsername(username, true)
  if (existingUser === null) {
    const createdUser = await usersRepository.createUser({
      username,
      passwordHash,
      email: normalizedEmail,
      createdIp: null,
      role: 'admin',
      isActive: true,
      apiKey: null,
      apiActive: false,
      apiQuota: DEFAULT_ADMIN_API_QUOTA,
    })
    return { status: 'created', user: createdUser }
  }

  await usersRepository.updatePasswordHash(existingUser.id, passwordHash)
  if (existingUser.role !== 'admin') {
    await usersRepository.updateUserRole(existingUser.id, 'admin')
  }
  if (!existingUser.isActive) {
    await usersRepository.toggleUserActive(existingUser.id)
  }

  const refreshedUser = await usersRepository.findById(existingUser.id, true)
  return {
    status: 'updated',
    user: refreshedUser ?? existingUser,
  }
}

async function readPasswordFromEnvironmentOrStdin(): Promise<string> {
  const envPassword = process.env['ADMIN_PASSWORD']
  if (envPassword !== undefined && envPassword.length > 0) {
    return envPassword
  }

  if (!process.stdin.isTTY) {
    const pipedInput = await text(process.stdin)
    return pipedInput.replace(/\r?\n$/, '')
  }

  throw new Error(
    'Provide the password via ADMIN_PASSWORD or piped stdin (e.g. ADMIN_PASSWORD=\'...\' pnpm run create-admin <username> [email]).',
  )
}

async function runCli(): Promise<void> {
  const [rawUsername, rawEmail] = process.argv.slice(2)
  if (rawUsername === undefined || rawUsername.trim().length === 0) {
    console.error('Usage: ADMIN_PASSWORD=\'...\' pnpm run create-admin <username> [email]')
    process.exitCode = 1
    return
  }

  const databaseUrl = process.env['DATABASE_URL']?.trim() ?? ''
  if (databaseUrl.length === 0) {
    console.error('Missing required environment variable: DATABASE_URL')
    process.exitCode = 1
    return
  }

  const password = await readPasswordFromEnvironmentOrStdin()
  const sql = createPostgresClient(databaseUrl, { max: 1, connect_timeout: 10 })
  try {
    const usersRepository = createPostgresUsersRepository(sql)
    const outcome = await ensureAdministratorAccount(usersRepository, {
      username: rawUsername,
      password,
      email: rawEmail ?? null,
    })
    process.stdout.write(
      `Administrator account '${outcome.user.username}' ${outcome.status} (id=${outcome.user.id}).\n`,
    )
  }
  finally {
    await sql.end({ timeout: 5 })
  }
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
