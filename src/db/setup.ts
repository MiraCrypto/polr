import type { Sql } from 'postgres'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadOptionalEnvFile } from '../config.js'
import { createPostgresClient } from './client.js'

const SCHEMA_CANDIDATE_PATHS = [
  fileURLToPath(new URL('./schema.sql', import.meta.url)),
  fileURLToPath(new URL('../../src/db/schema.sql', import.meta.url)),
  fileURLToPath(new URL('../../schema.sql', import.meta.url)),
] as const

export function resolveDefaultSchemaFilePath(): string {
  for (const candidatePath of SCHEMA_CANDIDATE_PATHS) {
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }
  return SCHEMA_CANDIDATE_PATHS[0]
}

export async function applyDatabaseSchema(
  sql: Sql,
  schemaFilePath: string = resolveDefaultSchemaFilePath(),
): Promise<void> {
  const schemaSql = await readFile(schemaFilePath, 'utf8')
  await sql.begin(async (transaction) => {
    await transaction.unsafe(schemaSql)
  })
}

async function runCli(): Promise<void> {
  const [rawSchemaPath] = process.argv.slice(2)
  loadOptionalEnvFile()
  const databaseUrl = process.env['DATABASE_URL']?.trim() ?? ''
  if (databaseUrl.length === 0) {
    console.error('Missing required environment variable: DATABASE_URL')
    process.exitCode = 1
    return
  }

  const schemaFilePath = rawSchemaPath !== undefined && rawSchemaPath.trim().length > 0
    ? rawSchemaPath.trim()
    : resolveDefaultSchemaFilePath()

  const sql = createPostgresClient(databaseUrl, { max: 1, connect_timeout: 10 })
  try {
    await applyDatabaseSchema(sql, schemaFilePath)
    process.stdout.write(`Database schema initialized from '${schemaFilePath}'.\n`)
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
