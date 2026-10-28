import type { Sql } from 'postgres'
import type { DataTablesQueryParameters, DataTablesResponse, LinkRecord } from '../domain/types.js'
import type { CreateLinkParameters, LinksRepository } from './repositories.js'

interface RawLinkRow {
  readonly id: number
  readonly short_url: string
  readonly long_url: string
  readonly created_ip: string
  readonly creator_id: number | null
  readonly creator_username: string | null
  readonly clicks: string | number
  readonly secret_key: string | null
  readonly is_disabled: boolean
  readonly is_custom: boolean
  readonly is_api: boolean
  readonly created_at: Date
  readonly updated_at: Date
}

function mapRawLinkRowToLinkRecord(row: RawLinkRow): LinkRecord {
  return {
    id: row.id,
    shortUrl: row.short_url,
    longUrl: row.long_url,
    createdIp: row.created_ip,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    clicks: Number(row.clicks),
    secretKey: row.secret_key,
    isDisabled: row.is_disabled,
    isCustom: row.is_custom,
    isApi: row.is_api,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ADMIN_LINKS_SORTABLE_COLUMNS: Record<number, string> = {
  0: 'links.short_url',
  1: 'links.long_url',
  2: 'links.clicks',
  3: 'links.created_at',
  4: 'users.username',
}

const USER_LINKS_SORTABLE_COLUMNS: Record<number, string> = {
  0: 'links.short_url',
  1: 'links.long_url',
  2: 'links.clicks',
  3: 'links.created_at',
}

export function createPostgresLinksRepository(sql: Sql): LinksRepository {
  const selectJoinedLinkFromLinks = sql`
    SELECT
      links.id,
      links.short_url,
      links.long_url,
      host(links.created_ip) AS created_ip,
      links.creator_id,
      users.username AS creator_username,
      links.clicks,
      links.secret_key,
      links.is_disabled,
      links.is_custom,
      links.is_api,
      links.created_at,
      links.updated_at
    FROM links
    LEFT JOIN users ON users.id = links.creator_id
  `

  return {
    async findByShortUrl(
      shortUrl: string,
      allowCaseInsensitiveCustomFallback: boolean = false,
    ): Promise<LinkRecord | null> {
      const exactRows = await sql<RawLinkRow[]>`
        ${selectJoinedLinkFromLinks}
        WHERE links.short_url = ${shortUrl}
        LIMIT 1
      `
      const exactMatch = exactRows[0]
      if (exactMatch !== undefined) {
        return mapRawLinkRowToLinkRecord(exactMatch)
      }

      if (!allowCaseInsensitiveCustomFallback) {
        return null
      }

      const fallbackRows = await sql<RawLinkRow[]>`
        ${selectJoinedLinkFromLinks}
        WHERE lower(links.short_url) = lower(${shortUrl}) AND links.is_custom = TRUE
        LIMIT 1
      `
      const fallbackMatch = fallbackRows[0]
      return fallbackMatch !== undefined
        ? mapRawLinkRowToLinkRecord(fallbackMatch)
        : null
    },

    async findExistingNonCustomLink(longUrl: string, creatorId: number | null): Promise<LinkRecord | null> {
      const creatorClause = creatorId !== null
        ? sql`links.creator_id = ${creatorId}`
        : sql`links.creator_id IS NULL`

      const rows = await sql<RawLinkRow[]>`
        ${selectJoinedLinkFromLinks}
        WHERE ${creatorClause}
          AND md5(links.long_url) = md5(${longUrl}::text)
          AND links.long_url = ${longUrl}
          AND links.is_custom = FALSE
          AND links.secret_key IS NULL
        ORDER BY links.id DESC
        LIMIT 1
      `
      const existingRow = rows[0]
      return existingRow !== undefined
        ? mapRawLinkRowToLinkRecord(existingRow)
        : null
    },

    async allocateNextCounterValue(): Promise<number> {
      const rows = await sql<Array<{ readonly next_value: string }>>`
        SELECT nextval('link_counter_seq')::text AS next_value
      `
      return Number(rows[0]?.next_value ?? 0)
    },

    async createLink(parameters: CreateLinkParameters): Promise<LinkRecord> {
      const rows = await sql<RawLinkRow[]>`
        WITH inserted AS (
          INSERT INTO links (
            short_url,
            long_url,
            created_ip,
            creator_id,
            secret_key,
            is_custom,
            is_api
          ) VALUES (
            ${parameters.shortUrl},
            ${parameters.longUrl},
            ${parameters.createdIp},
            ${parameters.creatorId},
            ${parameters.secretKey},
            ${parameters.isCustom},
            ${parameters.isApi}
          )
          RETURNING *
        )
        SELECT
          inserted.id,
          inserted.short_url,
          inserted.long_url,
          host(inserted.created_ip) AS created_ip,
          inserted.creator_id,
          users.username AS creator_username,
          inserted.clicks,
          inserted.secret_key,
          inserted.is_disabled,
          inserted.is_custom,
          inserted.is_api,
          inserted.created_at,
          inserted.updated_at
        FROM inserted
        LEFT JOIN users ON users.id = inserted.creator_id
      `
      const createdRow = rows[0]
      if (createdRow === undefined) {
        throw new Error('Failed to insert link record')
      }
      return mapRawLinkRowToLinkRecord(createdRow)
    },

    async incrementClicks(linkId: number): Promise<void> {
      await sql`
        UPDATE links
        SET clicks = clicks + 1, updated_at = NOW()
        WHERE id = ${linkId}
      `
    },

    async toggleLinkDisabled(shortUrl: string): Promise<boolean | null> {
      const rows = await sql<Array<{ readonly is_disabled: boolean }>>`
        UPDATE links
        SET is_disabled = NOT is_disabled, updated_at = NOW()
        WHERE short_url = ${shortUrl}
        RETURNING is_disabled
      `
      return rows[0]?.is_disabled ?? null
    },

    async updateLongUrl(shortUrl: string, newLongUrl: string): Promise<boolean> {
      const result = await sql`
        UPDATE links
        SET long_url = ${newLongUrl}, updated_at = NOW()
        WHERE short_url = ${shortUrl}
      `
      return result.count > 0
    },

    async deleteLink(shortUrl: string): Promise<boolean> {
      const result = await sql`
        DELETE FROM links
        WHERE short_url = ${shortUrl}
      `
      return result.count > 0
    },

    async countRecentApiLinksByCreator(creatorId: number, sinceTimestamp: Date): Promise<number> {
      const rows = await sql<Array<{ readonly count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM links
        WHERE creator_id = ${creatorId}
          AND is_api = TRUE
          AND created_at >= ${sinceTimestamp}
      `
      return Number(rows[0]?.count ?? 0)
    },

    async paginateAdminLinks(query: DataTablesQueryParameters): Promise<DataTablesResponse<LinkRecord>> {
      const sortColumn = ADMIN_LINKS_SORTABLE_COLUMNS[query.orderColumnIndex] ?? 'links.created_at'
      const sortDirectionSql = query.orderDirection === 'desc'
        ? sql`DESC`
        : sql`ASC`
      const hasSearch = query.searchValue.trim().length > 0
      const searchPattern = `%${query.searchValue.trim()}%`

      const totalCountRows = await sql<Array<{ readonly count: string }>>`
        SELECT COUNT(*)::text AS count FROM links
      `
      const recordsTotal = Number(totalCountRows[0]?.count ?? 0)

      const whereFragment = hasSearch
        ? sql`WHERE links.short_url ILIKE ${searchPattern} OR links.long_url ILIKE ${searchPattern} OR COALESCE(users.username, '') ILIKE ${searchPattern}`
        : sql``

      const filteredCountRows = hasSearch
        ? await sql<Array<{ readonly count: string }>>`
            SELECT COUNT(*)::text AS count
            FROM links
            LEFT JOIN users ON users.id = links.creator_id
            ${whereFragment}
          `
        : totalCountRows
      const recordsFiltered = Number(filteredCountRows[0]?.count ?? 0)

      const rows = await sql<RawLinkRow[]>`
        ${selectJoinedLinkFromLinks}
        ${whereFragment}
        ORDER BY ${sql(sortColumn)} ${sortDirectionSql}, links.id DESC
        LIMIT ${query.length} OFFSET ${query.start}
      `

      return {
        draw: query.draw,
        recordsTotal,
        recordsFiltered,
        data: rows.map(mapRawLinkRowToLinkRecord),
      }
    },

    async paginateUserLinks(
      creatorId: number,
      query: DataTablesQueryParameters,
    ): Promise<DataTablesResponse<LinkRecord>> {
      const sortColumn = USER_LINKS_SORTABLE_COLUMNS[query.orderColumnIndex] ?? 'links.created_at'
      const sortDirectionSql = query.orderDirection === 'desc'
        ? sql`DESC`
        : sql`ASC`
      const hasSearch = query.searchValue.trim().length > 0
      const searchPattern = `%${query.searchValue.trim()}%`

      const totalCountRows = await sql<Array<{ readonly count: string }>>`
        SELECT COUNT(*)::text AS count
        FROM links
        WHERE creator_id = ${creatorId}
      `
      const recordsTotal = Number(totalCountRows[0]?.count ?? 0)

      const whereFragment = hasSearch
        ? sql`WHERE links.creator_id = ${creatorId} AND (links.short_url ILIKE ${searchPattern} OR links.long_url ILIKE ${searchPattern})`
        : sql`WHERE links.creator_id = ${creatorId}`

      const filteredCountRows = hasSearch
        ? await sql<Array<{ readonly count: string }>>`
            SELECT COUNT(*)::text AS count
            FROM links
            ${whereFragment}
          `
        : totalCountRows
      const recordsFiltered = Number(filteredCountRows[0]?.count ?? 0)

      const rows = await sql<RawLinkRow[]>`
        ${selectJoinedLinkFromLinks}
        ${whereFragment}
        ORDER BY ${sql(sortColumn)} ${sortDirectionSql}, links.id DESC
        LIMIT ${query.length} OFFSET ${query.start}
      `

      return {
        draw: query.draw,
        recordsTotal,
        recordsFiltered,
        data: rows.map(mapRawLinkRowToLinkRecord),
      }
    },
  }
}
