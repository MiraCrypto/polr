import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_MYSQL_STDOUT_BUFFER_BYTES = 256 * 1024 * 1024

const SELECT_LEGACY_USERS_SQL = `
  SELECT id, username, password, email, ip, role, active, api_key, api_active, api_quota, created_at, updated_at
  FROM users
  WHERE deleted_at IS NULL
  ORDER BY id ASC
`

const SELECT_LEGACY_LINKS_SQL = `
  SELECT id, short_url, long_url, ip, creator, clicks, secret_key, is_disabled, is_custom, is_api, created_at, updated_at
  FROM links
  ORDER BY id ASC
`

export function unescapeMysqlBatchCell(rawCell: string): string | null {
  if (rawCell === '\\N') {
    return null
  }

  let unescaped = ''
  for (let index = 0; index < rawCell.length; index += 1) {
    const character = rawCell[index] ?? ''
    if (character !== '\\' || index + 1 >= rawCell.length) {
      unescaped += character
      continue
    }

    index += 1
    const nextCharacter = rawCell[index] ?? ''
    if (nextCharacter === 'n') {
      unescaped += '\n'
    }
    else if (nextCharacter === 'r') {
      unescaped += '\r'
    }
    else if (nextCharacter === 't') {
      unescaped += '\t'
    }
    else if (nextCharacter === '0') {
      unescaped += '\0'
    }
    else if (nextCharacter === 'Z') {
      unescaped += '\x1A'
    }
    else {
      unescaped += nextCharacter
    }
  }

  return unescaped
}

export function parseMysqlBatchOutput(tsvOutput: string): ReadonlyArray<Record<string, string | null>> {
  const normalizedOutput = tsvOutput.replace(/\r?\n$/, '')
  if (normalizedOutput.length === 0) {
    return []
  }

  const lines = normalizedOutput.split(/\r?\n/)
  const headerLine = lines[0]
  if (headerLine === undefined || headerLine.length === 0) {
    return []
  }

  const columnNames = headerLine.split('\t')
  const rows: Array<Record<string, string | null>> = []

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    if (line === undefined || line.length === 0) {
      continue
    }

    const cells = line.split('\t')
    const row: Record<string, string | null> = {}
    for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex += 1) {
      const columnName = columnNames[columnIndex]
      if (columnName !== undefined) {
        row[columnName] = unescapeMysqlBatchCell(cells[columnIndex] ?? '')
      }
    }
    rows.push(row)
  }

  return rows
}

function buildMysqlCliArguments(environmentVariables: NodeJS.ProcessEnv, sqlQuery: string): {
  readonly binary: string
  readonly args: readonly string[]
  readonly childEnv: NodeJS.ProcessEnv
} {
  const databaseName = environmentVariables['MYSQL_DATABASE']?.trim() ?? ''
  if (databaseName.length === 0) {
    throw new Error('Missing required environment variable: MYSQL_DATABASE')
  }

  const binary = environmentVariables['MYSQL_BIN']?.trim() || 'mysql'
  const args: string[] = ['--batch', '--default-character-set=utf8mb4']

  const host = environmentVariables['MYSQL_HOST']?.trim() ?? ''
  if (host.length > 0) {
    args.push('--host', host)
  }

  const port = environmentVariables['MYSQL_PORT']?.trim() ?? ''
  if (port.length > 0) {
    args.push('--port', port)
  }

  const socketPath = environmentVariables['MYSQL_SOCKET']?.trim() ?? ''
  if (socketPath.length > 0) {
    args.push('--socket', socketPath)
  }

  const user = environmentVariables['MYSQL_USER']?.trim() ?? ''
  if (user.length > 0) {
    args.push('--user', user)
  }

  args.push(databaseName, '--execute', sqlQuery)

  const password = environmentVariables['MYSQL_PWD'] ?? environmentVariables['MYSQL_PASSWORD']
  const childEnv: NodeJS.ProcessEnv = password !== undefined
    ? { ...environmentVariables, MYSQL_PWD: password }
    : { ...environmentVariables }

  return { binary, args, childEnv }
}

async function queryMysqlTable(
  environmentVariables: NodeJS.ProcessEnv,
  sqlQuery: string,
): Promise<ReadonlyArray<Record<string, string | null>>> {
  const { binary, args, childEnv } = buildMysqlCliArguments(environmentVariables, sqlQuery)
  const { stdout } = await execFileAsync(binary, [...args], {
    env: childEnv,
    maxBuffer: MAX_MYSQL_STDOUT_BUFFER_BYTES,
  })
  return parseMysqlBatchOutput(stdout)
}

async function runCli(): Promise<void> {
  const outputPath = process.argv[2]?.trim() ?? ''
  if (outputPath.length === 0) {
    console.error(
      'Usage: MYSQL_DATABASE=polr MYSQL_USER=polr MYSQL_PWD=\'...\' node scripts/legacy-migration/export-mysql.ts <output-dump.json>',
    )
    process.exitCode = 1
    return
  }

  const users = await queryMysqlTable(process.env, SELECT_LEGACY_USERS_SQL)
  const links = await queryMysqlTable(process.env, SELECT_LEGACY_LINKS_SQL)

  const payload = JSON.stringify({ users, links }, null, 2)
  await writeFile(outputPath, `${payload}\n`, 'utf8')
  process.stdout.write(
    `Exported ${users.length} legacy users and ${links.length} legacy links to ${outputPath}.\n`,
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
