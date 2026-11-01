import type { UsersRepository } from './db/repositories.js'
import type { UserRecord, UserRole } from './domain/types.js'
import { text } from 'node:stream/consumers'
import { loadOptionalEnvFile } from './config.js'
import { createPostgresClient } from './db/client.js'
import { createPostgresUsersRepository } from './db/usersRepository.js'
import { hashPasswordWithBcrypt } from './domain/authService.js'
import { isValidEndingSyntax } from './domain/linkService.js'

const DEFAULT_USER_API_QUOTA = 60

export interface EnsureAdministratorInput {
  readonly username: string
  readonly password: string
  readonly email?: string | null
}

export interface EnsureUserInput extends EnsureAdministratorInput {
  readonly role?: UserRole
}

export interface EnsureAdministratorOutcome {
  readonly status: 'created' | 'updated'
  readonly user: UserRecord
}

export type EnsureUserOutcome = EnsureAdministratorOutcome

export interface ParsedUserCliArguments {
  readonly username: string
  readonly email: string | null
  readonly role: UserRole
}

function parseRoleOptionValue(rawRole: string): UserRole {
  const normalizedRole = rawRole.trim().toLowerCase()
  if (normalizedRole === 'user' || normalizedRole === 'admin') {
    return normalizedRole
  }
  throw new Error(`Invalid role '${rawRole}': must be 'user' or 'admin'.`)
}

export function parseUserCliArguments(
  rawArgs: readonly string[],
  defaultRole: UserRole = 'admin',
): ParsedUserCliArguments | null {
  let role: UserRole = defaultRole
  const positionalArgs: string[] = []

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index] ?? ''
    if (argument === '--role') {
      const nextArgument = rawArgs[index + 1]
      if (nextArgument === undefined) {
        throw new Error('Missing value for --role (expected \'user\' or \'admin\').')
      }
      role = parseRoleOptionValue(nextArgument)
      index += 1
      continue
    }

    if (argument.startsWith('--role=')) {
      role = parseRoleOptionValue(argument.slice('--role='.length))
      continue
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option '${argument}'.`)
    }

    positionalArgs.push(argument)
  }

  const [rawUsername, rawEmail, ...extraArguments] = positionalArgs
  if (extraArguments.length > 0) {
    throw new Error(`Unexpected extra argument '${extraArguments[0]}'.`)
  }

  if (rawUsername === undefined || rawUsername.trim().length === 0) {
    return null
  }

  return {
    username: rawUsername,
    email: rawEmail ?? null,
    role,
  }
}

export async function ensureUserAccount(
  usersRepository: UsersRepository,
  input: EnsureUserInput,
): Promise<EnsureUserOutcome> {
  const username = input.username.trim()
  if (!isValidEndingSyntax(username)) {
    throw new Error(
      'Invalid username: may only contain alphanumeric characters, hyphens, and underscores.',
    )
  }

  if (input.password.length === 0) {
    throw new Error('Password must not be empty.')
  }

  const targetRole: UserRole = input.role ?? 'user'
  if (targetRole !== 'user' && targetRole !== 'admin') {
    throw new Error(`Invalid role '${String(targetRole)}': must be 'user' or 'admin'.`)
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
      role: targetRole,
      isActive: true,
      apiKey: null,
      apiActive: false,
      apiQuota: DEFAULT_USER_API_QUOTA,
    })
    return { status: 'created', user: createdUser }
  }

  await usersRepository.updatePasswordHash(existingUser.id, passwordHash)
  if (existingUser.role !== targetRole) {
    await usersRepository.updateUserRole(existingUser.id, targetRole)
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

export async function ensureAdministratorAccount(
  usersRepository: UsersRepository,
  input: EnsureAdministratorInput,
): Promise<EnsureAdministratorOutcome> {
  return ensureUserAccount(usersRepository, {
    ...input,
    role: 'admin',
  })
}

async function readPasswordFromEnvironmentOrStdin(): Promise<string> {
  const envPassword = process.env['USER_PASSWORD'] || process.env['ADMIN_PASSWORD']
  if (envPassword !== undefined && envPassword.length > 0) {
    return envPassword
  }

  if (!process.stdin.isTTY) {
    const pipedInput = await text(process.stdin)
    return pipedInput.replace(/\r?\n$/, '')
  }

  throw new Error(
    'Provide the password via USER_PASSWORD, ADMIN_PASSWORD, or piped stdin (e.g. ADMIN_PASSWORD=\'...\' pnpm run create-admin <username> [email] [--role=admin|user]).',
  )
}

async function runCli(): Promise<void> {
  const parsedArgs = parseUserCliArguments(process.argv.slice(2))
  if (parsedArgs === null) {
    console.error(
      'Usage: ADMIN_PASSWORD=\'...\' pnpm run create-admin <username> [email] [--role=admin|user]',
    )
    process.exitCode = 1
    return
  }

  loadOptionalEnvFile()
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
    const outcome = await ensureUserAccount(usersRepository, {
      username: parsedArgs.username,
      password,
      email: parsedArgs.email,
      role: parsedArgs.role,
    })
    const accountLabel = outcome.user.role === 'admin'
      ? 'Administrator account'
      : 'User account'
    process.stdout.write(
      `${accountLabel} '${outcome.user.username}' ${outcome.status} (id=${outcome.user.id}, role=${outcome.user.role}).\n`,
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
