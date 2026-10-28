import type { Sql } from 'postgres'
import type { DataTablesQueryParameters, DataTablesResponse, UserRecord, UserRole } from '../domain/types.js'
import type { CreateUserParameters, UsersRepository } from './repositories.js'

interface RawUserRow {
  readonly id: number
  readonly username: string
  readonly password_hash: string | null
  readonly email: string | null
  readonly created_ip: string | null
  readonly role: UserRole
  readonly is_active: boolean
  readonly api_key: string | null
  readonly api_active: boolean
  readonly api_quota: number
  readonly created_at: Date
  readonly updated_at: Date
}

function mapRawUserRowToUserRecord(row: RawUserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    email: row.email,
    createdIp: row.created_ip,
    role: row.role,
    isActive: row.is_active,
    apiKey: row.api_key,
    apiActive: row.api_active,
    apiQuota: row.api_quota,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ADMIN_USERS_SORTABLE_COLUMNS: Record<number, 'username' | 'email' | 'created_at'> = {
  0: 'username',
  1: 'email',
  2: 'created_at',
}

export function createPostgresUsersRepository(sql: Sql): UsersRepository {
  const selectUserColumns = sql`
    id,
    username,
    password_hash,
    email,
    host(created_ip) AS created_ip,
    role,
    is_active,
    api_key,
    api_active,
    api_quota,
    created_at,
    updated_at
  `

  return {
    async findById(id: number, includeInactive: boolean = false): Promise<UserRecord | null> {
      const activeClause = includeInactive
        ? sql``
        : sql`AND is_active = TRUE`
      const rows = await sql<RawUserRow[]>`
        SELECT ${selectUserColumns}
        FROM users
        WHERE id = ${id} ${activeClause}
        LIMIT 1
      `
      const firstRow = rows[0]
      return firstRow !== undefined
        ? mapRawUserRowToUserRecord(firstRow)
        : null
    },

    async findByUsername(username: string, includeInactive: boolean = false): Promise<UserRecord | null> {
      const activeClause = includeInactive
        ? sql``
        : sql`AND is_active = TRUE`
      const rows = await sql<RawUserRow[]>`
        SELECT ${selectUserColumns}
        FROM users
        WHERE username = ${username} ${activeClause}
        LIMIT 1
      `
      const firstRow = rows[0]
      return firstRow !== undefined
        ? mapRawUserRowToUserRecord(firstRow)
        : null
    },

    async findActiveByApiKey(apiKey: string): Promise<UserRecord | null> {
      const rows = await sql<RawUserRow[]>`
        SELECT ${selectUserColumns}
        FROM users
        WHERE api_key = ${apiKey} AND is_active = TRUE AND api_active = TRUE
        LIMIT 1
      `
      const firstRow = rows[0]
      return firstRow !== undefined
        ? mapRawUserRowToUserRecord(firstRow)
        : null
    },

    async createUser(parameters: CreateUserParameters): Promise<UserRecord> {
      const rows = await sql<RawUserRow[]>`
        INSERT INTO users (
          username,
          password_hash,
          email,
          created_ip,
          role,
          is_active,
          api_key,
          api_active,
          api_quota
        ) VALUES (
          ${parameters.username},
          ${parameters.passwordHash},
          ${parameters.email},
          ${parameters.createdIp},
          ${parameters.role},
          ${parameters.isActive},
          ${parameters.apiKey},
          ${parameters.apiActive},
          ${parameters.apiQuota}
        )
        RETURNING ${selectUserColumns}
      `
      const createdRow = rows[0]
      if (createdRow === undefined) {
        throw new Error('Failed to insert user record')
      }
      return mapRawUserRowToUserRecord(createdRow)
    },

    async updatePasswordHash(userId: number, newPasswordHash: string): Promise<void> {
      await sql`
        UPDATE users
        SET password_hash = ${newPasswordHash}, updated_at = NOW()
        WHERE id = ${userId}
      `
    },

    async toggleApiActive(userId: number): Promise<boolean | null> {
      const rows = await sql<Array<{ readonly api_active: boolean }>>`
        UPDATE users
        SET api_active = NOT api_active, updated_at = NOW()
        WHERE id = ${userId}
        RETURNING api_active
      `
      return rows[0]?.api_active ?? null
    },

    async updateApiKey(userId: number, newApiKey: string): Promise<string | null> {
      const rows = await sql<Array<{ readonly api_key: string }>>`
        UPDATE users
        SET api_key = ${newApiKey}, updated_at = NOW()
        WHERE id = ${userId}
        RETURNING api_key
      `
      return rows[0]?.api_key ?? null
    },

    async updateApiQuota(userId: number, newQuota: number): Promise<boolean> {
      const result = await sql`
        UPDATE users
        SET api_quota = ${newQuota}, updated_at = NOW()
        WHERE id = ${userId}
      `
      return result.count > 0
    },

    async toggleUserActive(userId: number): Promise<boolean | null> {
      const rows = await sql<Array<{ readonly is_active: boolean }>>`
        UPDATE users
        SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = ${userId}
        RETURNING is_active
      `
      return rows[0]?.is_active ?? null
    },

    async updateUserRole(userId: number, newRole: UserRole): Promise<boolean> {
      const result = await sql`
        UPDATE users
        SET role = ${newRole}, updated_at = NOW()
        WHERE id = ${userId}
      `
      return result.count > 0
    },

    async deleteUser(userId: number): Promise<boolean> {
      const result = await sql`
        DELETE FROM users
        WHERE id = ${userId}
      `
      return result.count > 0
    },

    async paginateAdminUsers(query: DataTablesQueryParameters): Promise<DataTablesResponse<UserRecord>> {
      const sortColumn = ADMIN_USERS_SORTABLE_COLUMNS[query.orderColumnIndex] ?? 'username'
      const sortDirectionSql = query.orderDirection === 'desc'
        ? sql`DESC`
        : sql`ASC`
      const hasSearch = query.searchValue.trim().length > 0
      const searchPattern = `%${query.searchValue.trim()}%`

      const totalCountRows = await sql<Array<{ readonly count: string }>>`
        SELECT COUNT(*)::text AS count FROM users
      `
      const recordsTotal = Number(totalCountRows[0]?.count ?? 0)

      const whereFragment = hasSearch
        ? sql`WHERE username ILIKE ${searchPattern} OR COALESCE(email, '') ILIKE ${searchPattern}`
        : sql``

      const filteredCountRows = hasSearch
        ? await sql<Array<{ readonly count: string }>>`
            SELECT COUNT(*)::text AS count FROM users ${whereFragment}
          `
        : totalCountRows
      const recordsFiltered = Number(filteredCountRows[0]?.count ?? 0)

      const rows = await sql<RawUserRow[]>`
        SELECT ${selectUserColumns}
        FROM users
        ${whereFragment}
        ORDER BY ${sql(sortColumn)} ${sortDirectionSql}, id ASC
        LIMIT ${query.length} OFFSET ${query.start}
      `

      return {
        draw: query.draw,
        recordsTotal,
        recordsFiltered,
        data: rows.map(mapRawUserRowToUserRecord),
      }
    },
  }
}
