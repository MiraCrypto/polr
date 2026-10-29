import { describe, expect, it } from 'vitest'
import { parseMysqlBatchOutput, unescapeMysqlBatchCell } from './export-mysql.js'
import {
  calculateNextCounterSequenceValue,
  normalizeLegacyDumpForPostgres,
} from './import-postgres.js'

describe('legacy Polr 2 MySQL-to-PostgreSQL migration utilities', () => {
  it('decodes MySQL batch TSV escapes and preserves SQL NULL vs literal "NULL"', () => {
    expect(unescapeMysqlBatchCell('\\N')).toBeNull()
    expect(unescapeMysqlBatchCell('NULL')).toBe('NULL')
    expect(unescapeMysqlBatchCell('line1\\nline2\\t\\\\end')).toBe('line1\nline2\t\\end')

    const batchTsv = [
      'id\tshort_url\tlong_url\tsecret_key',
      '1\t0\thttps://example.org/path?a=1\\tb=2\t\\N',
      '2\tNULL\thttps://example.org/literal-null-slug\tab12',
      '',
    ].join('\n')

    expect(parseMysqlBatchOutput(batchTsv)).toEqual([
      {
        id: '1',
        short_url: '0',
        long_url: 'https://example.org/path?a=1\tb=2',
        secret_key: null,
      },
      {
        id: '2',
        short_url: 'NULL',
        long_url: 'https://example.org/literal-null-slug',
        secret_key: 'ab12',
      },
    ])
    expect(parseMysqlBatchOutput('')).toEqual([])
  })

  it('normalizes legacy users, links, foreign keys, zero timestamps, and Base-62 sequence counters', () => {
    const plan = normalizeLegacyDumpForPostgres({
      users: [
        {
          id: '1',
          username: 'admin_one',
          password: '$2y$10$examplebcryptpasswordhash000000000000000000000000000',
          email: 'admin@example.org',
          ip: '192.0.2.10',
          role: 'admin',
          active: '1',
          api_key: 'shared-legacy-key',
          api_active: '1',
          api_quota: '-1',
          created_at: '0000-00-00 00:00:00',
          updated_at: '2022-05-01 12:00:00',
        },
        {
          id: '2',
          username: '   ',
          password: '',
          email: '',
          ip: 'not-an-ip',
          role: '',
          active: '0',
          api_key: null,
          api_active: 0,
          api_quota: '60',
          created_at: '0000-00-00 00:00:00',
          updated_at: '0000-00-00 00:00:00',
        },
        {
          id: '3',
          username: 'editor_two',
          password: '',
          email: '',
          ip: 'not-an-ip',
          role: '',
          active: '0',
          api_key: 'shared-legacy-key',
          api_active: 0,
          api_quota: '-99',
          created_at: '2021-03-10 08:30:00',
          updated_at: '2021-03-10 08:30:00',
        },
      ],
      links: [
        {
          id: '10',
          short_url: '1Z',
          long_url: 'https://example.com/target-one',
          ip: '198.51.100.4',
          creator: 'admin_one',
          clicks: '42',
          secret_key: '',
          is_disabled: 0,
          is_custom: 0,
          is_api: 1,
          created_at: '2019-06-15 04:00:00',
          updated_at: '0000-00-00 00:00:00',
        },
        {
          id: '11',
          short_url: 'admin',
          long_url: 'https://example.com/shadowed-route',
          ip: '198.51.100.4',
          creator: 'admin_one',
          clicks: 0,
          secret_key: null,
          is_disabled: 0,
          is_custom: 1,
          is_api: 0,
          created_at: '2020-01-01 00:00:00',
          updated_at: '2020-01-01 00:00:00',
        },
        {
          id: '12',
          short_url: 'CustomSlug',
          long_url: 'https://example.com/custom-destination',
          ip: 'invalid-ip',
          creator: 'deleted_ghost_user',
          clicks: '-5',
          secret_key: 'f00d',
          is_disabled: '1',
          is_custom: '1',
          is_api: '0',
          created_at: '2020-08-20 10:15:00',
          updated_at: '2020-08-20 10:15:00',
        },
      ],
    })

    expect(plan.skippedUsersCount).toBe(1)
    expect(plan.users).toHaveLength(2)
    expect(plan.users[0]).toMatchObject({
      id: 1,
      username: 'admin_one',
      role: 'admin',
      isActive: true,
      apiKey: 'shared-legacy-key',
      apiActive: true,
      apiQuota: -1,
      createdAt: new Date('2019-06-15T04:00:00.000Z'),
    })
    expect(plan.users[1]).toMatchObject({
      id: 3,
      username: 'editor_two',
      passwordHash: null,
      email: null,
      createdIp: null,
      role: 'user',
      isActive: false,
      apiKey: null,
      apiQuota: -1,
    })

    expect(plan.skippedLinksCount).toBe(1)
    expect(plan.links).toHaveLength(2)
    expect(plan.links[0]).toMatchObject({
      id: 10,
      shortUrl: '1Z',
      creatorId: 1,
      clicks: 42,
      secretKey: null,
      isCustom: false,
      isApi: true,
      updatedAt: new Date('2019-06-15T04:00:00.000Z'),
    })
    expect(plan.links[1]).toMatchObject({
      id: 12,
      shortUrl: 'CustomSlug',
      createdIp: '127.0.0.1',
      creatorId: null,
      clicks: 0,
      secretKey: 'f00d',
      isDisabled: true,
      isCustom: true,
    })

    // '1Z' in Base-62 is 1 * 62 + 61 = 123, so nextCounterSequenceValue = 124
    expect(plan.nextCounterSequenceValue).toBe(124)
    expect(calculateNextCounterSequenceValue([])).toBe(0)
  })
})
