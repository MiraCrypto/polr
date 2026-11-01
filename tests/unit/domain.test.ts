import { describe, expect, it } from 'vitest'
import {
  ensureAdministratorAccount,
  ensureUserAccount,
  parseUserCliArguments,
} from '../../src/createAdmin.js'
import {
  constantTimeStringEqual,
  hashPasswordWithBcrypt,
  parseSignedFlashToken,
  parseSignedSessionToken,
  serializeSignedFlashToken,
  serializeSignedSessionToken,
  verifyPasswordWithBcrypt,
} from '../../src/domain/authService.js'
import { encodeBaseNumber } from '../../src/domain/base62.js'
import {
  checkIfAlreadyShortenedUrl,
  formatShortenedUrl,
  isReservedRouteEnding,
  isValidEndingSyntax,
  isValidHttpUrl,
} from '../../src/domain/linkService.js'
import { formatUtcTimestamp, fromLegacyWireRole, toLegacyWireRole } from '../../src/domain/types.js'
import {
  escapeHtmlEntities,
  escapeSingleQuotedJsLiteralInHtmlAttribute,
  parseDataTablesQuery,
  renderAdminApiActionCellHtml,
  renderLongUrlCellHtml,
  renderToggleLinkActiveCellHtml,
  truncateStringWithEllipsis,
} from '../../src/views/dataTables.js'
import { TEST_CONFIGURATION } from '../helpers.js'
import { createInMemoryRepositories } from '../inMemoryRepositories.js'

describe('domain role wire mapping', () => {
  it('maps between internal UserRole and legacy wire strings', () => {
    expect(toLegacyWireRole('admin')).toBe('admin')
    expect(toLegacyWireRole('user')).toBe('')
    expect(fromLegacyWireRole('admin')).toBe('admin')
    expect(fromLegacyWireRole('')).toBe('user')
    expect(fromLegacyWireRole('unknown')).toBe('user')
  })
})

describe('base-32 and base-62 counter encoding', () => {
  it('encodes base-62 and base-32 integers accurately across digit boundaries', () => {
    expect(encodeBaseNumber(0, 62)).toBe('0')
    expect(encodeBaseNumber(61, 62)).toBe('Z')
    expect(encodeBaseNumber(62, 62)).toBe('10')
    expect(encodeBaseNumber(3843, 62)).toBe('ZZ')

    expect(encodeBaseNumber(0, 32)).toBe('0')
    expect(encodeBaseNumber(31, 32)).toBe('v')
    expect(encodeBaseNumber(32, 32)).toBe('10')
  })

  it('rejects negative or non-integer values', () => {
    expect(() => encodeBaseNumber(-1, 62)).toThrow(RangeError)
    expect(() => encodeBaseNumber(1.5, 62)).toThrow(RangeError)
  })
})

describe('authentication cryptography and signed tokens', () => {
  it('verifies standard and PHP $2y$ bcrypt hashes and rejects empty hashes', async () => {
    const hash = await hashPasswordWithBcrypt('correct-horse-battery')
    const phpHash = hash.replace(/^\$2[ab]\$/, '$2y$')
    expect(await verifyPasswordWithBcrypt('correct-horse-battery', phpHash)).toBe(true)
    expect(await verifyPasswordWithBcrypt('wrong-password', phpHash)).toBe(false)
    expect(await verifyPasswordWithBcrypt('any', null)).toBe(false)
    expect(await verifyPasswordWithBcrypt('any', '')).toBe(false)
  })

  it('compares strings in constant time without leaking length mismatches', () => {
    expect(constantTimeStringEqual('token-abc', 'token-abc')).toBe(true)
    expect(constantTimeStringEqual('token-abc', 'token-abd')).toBe(false)
    expect(constantTimeStringEqual('short', 'longer-string')).toBe(false)
  })

  it('signs and verifies session and flash tokens and rejects expired or tampered tokens', () => {
    const sessionToken = serializeSignedSessionToken(
      {
        userId: 7,
        username: 'operator',
        role: 'admin',
        csrfToken: 'csrf-hex-token',
        issuedAtEpochSeconds: 1_000_000,
      },
      'secret-key',
    )

    expect(parseSignedSessionToken(sessionToken, 'secret-key', 1_000_100)?.username).toBe('operator')
    expect(parseSignedSessionToken(sessionToken, 'wrong-key', 1_000_100)).toBeNull()
    expect(parseSignedSessionToken(`${sessionToken}x`, 'secret-key', 1_000_100)).toBeNull()
    expect(parseSignedSessionToken(sessionToken, 'secret-key', 1_000_000 + 60 * 60 * 24 * 31)).toBeNull()

    const flashToken = serializeSignedFlashToken(
      { type: 'error', message: 'Invalid credentials' },
      'secret-key',
    )
    expect(parseSignedFlashToken(flashToken, 'secret-key')).toEqual({
      type: 'error',
      message: 'Invalid credentials',
    })
    expect(parseSignedFlashToken(`${flashToken}tamper`, 'secret-key')).toBeNull()
  })
})

describe('administrator account bootstrap and recovery', () => {
  it('creates an initial admin user and idempotently promotes/resets an existing account', async () => {
    const { usersRepository } = createInMemoryRepositories()

    const created = await ensureAdministratorAccount(usersRepository, {
      username: '  initial_admin  ',
      password: 'first-password',
      email: 'admin@example.com',
    })
    expect(created.status).toBe('created')
    expect(created.user.username).toBe('initial_admin')
    expect(created.user.role).toBe('admin')
    expect(created.user.isActive).toBe(true)
    expect(await verifyPasswordWithBcrypt('first-password', created.user.passwordHash)).toBe(true)

    await usersRepository.updateUserRole(created.user.id, 'user')
    await usersRepository.toggleUserActive(created.user.id)

    const updated = await ensureAdministratorAccount(usersRepository, {
      username: 'initial_admin',
      password: 'recovered-password',
    })
    expect(updated.status).toBe('updated')
    expect(updated.user.role).toBe('admin')
    expect(updated.user.isActive).toBe(true)
    expect(await verifyPasswordWithBcrypt('recovered-password', updated.user.passwordHash)).toBe(true)

    await expect(
      ensureAdministratorAccount(usersRepository, { username: 'bad/name', password: 'pw' }),
    ).rejects.toThrow(/Invalid username/)
    await expect(
      ensureAdministratorAccount(usersRepository, { username: 'valid_admin', password: '' }),
    ).rejects.toThrow(/Password must not be empty/)
  })

  it('provisions standard non-admin user accounts and parses CLI role flags', async () => {
    const { usersRepository } = createInMemoryRepositories()

    const createdUser = await ensureUserAccount(usersRepository, {
      username: 'standard_member',
      password: 'member-password',
      email: 'member@example.com',
    })
    expect(createdUser.status).toBe('created')
    expect(createdUser.user.role).toBe('user')
    expect(createdUser.user.isActive).toBe(true)
    expect(await verifyPasswordWithBcrypt('member-password', createdUser.user.passwordHash)).toBe(true)

    const demotedAdmin = await ensureUserAccount(usersRepository, {
      username: 'standard_member',
      password: 'updated-password',
      role: 'admin',
    })
    expect(demotedAdmin.status).toBe('updated')
    expect(demotedAdmin.user.role).toBe('admin')

    const revertedToUser = await ensureUserAccount(usersRepository, {
      username: 'standard_member',
      password: 'final-password',
      role: 'user',
    })
    expect(revertedToUser.status).toBe('updated')
    expect(revertedToUser.user.role).toBe('user')

    expect(parseUserCliArguments([])).toBeNull()
    expect(parseUserCliArguments(['--role=user'])).toBeNull()
    expect(parseUserCliArguments(['alice', 'alice@example.com'])).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      role: 'admin',
    })
    expect(parseUserCliArguments(['--role=user', 'alice', 'alice@example.com'])).toEqual({
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
    })
    expect(parseUserCliArguments([
      '--role=user',
      'alice',
      '--role',
      'admin',
    ])).toEqual({
      username: 'alice',
      email: null,
      role: 'admin',
    })
    expect(() => parseUserCliArguments(['alice', '--role=owner'])).toThrow(/Invalid role/)
    expect(() => parseUserCliArguments(['alice', '--role'])).toThrow(/Missing value for --role/)
    expect(() => parseUserCliArguments(['alice', '--unknown'])).toThrow(/Unknown option/)
    expect(() => parseUserCliArguments(['alice', 'a@example.com', 'extra'])).toThrow(
      /Unexpected extra argument/,
    )
  })
})

describe('url and ending validation helpers', () => {
  it('accepts http, https, and ftp URLs and rejects dangerous schemes', () => {
    expect(isValidHttpUrl('https://example.com/path?x=1')).toBe(true)
    expect(isValidHttpUrl('http://example.com')).toBe(true)
    expect(isValidHttpUrl('ftp://files.example.com/pub')).toBe(true)
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isValidHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isValidHttpUrl('   ')).toBe(false)
  })

  it('distinguishes ending syntax from reserved route collisions', () => {
    expect(isValidEndingSyntax('valid_ending-123')).toBe(true)
    expect(isValidEndingSyntax('admin')).toBe(true)
    expect(isValidEndingSyntax('bad/slash')).toBe(false)
    expect(isValidEndingSyntax('bad space')).toBe(false)

    expect(isReservedRouteEnding('admin')).toBe(true)
    expect(isReservedRouteEnding('LOGIN')).toBe(true)
    expect(isReservedRouteEnding('custom-slug')).toBe(false)
  })

  it('detects already-shortened hosts accurately without blocking prefix-matching domains', () => {
    expect(checkIfAlreadyShortenedUrl('https://short.example.com/abc', 'short.example.com')).toBe(true)
    expect(checkIfAlreadyShortenedUrl('https://bit.ly/xyz', 'short.example.com')).toBe(true)
    expect(checkIfAlreadyShortenedUrl('https://sub.t.co/xyz', 'short.example.com')).toBe(true)
    expect(checkIfAlreadyShortenedUrl('http://localhost:3000/abc', 'localhost:3000')).toBe(true)

    expect(checkIfAlreadyShortenedUrl('https://t.company.com/report', 'short.example.com')).toBe(false)
    expect(checkIfAlreadyShortenedUrl('https://t.co.uk/news', 'short.example.com')).toBe(false)
    expect(checkIfAlreadyShortenedUrl('https://bit.lychee.org/doc', 'short.example.com')).toBe(false)
    expect(checkIfAlreadyShortenedUrl('http://localhost:30000/abc', 'localhost:3000')).toBe(false)
    expect(
      checkIfAlreadyShortenedUrl('https://example.org/share?u=https://t.co/xyz', 'short.example.com'),
    ).toBe(false)

    expect(formatShortenedUrl(TEST_CONFIGURATION, 'abc')).toBe('https://short.example.com/abc')
    expect(formatShortenedUrl(TEST_CONFIGURATION, 'abc', '9f0a')).toBe(
      'https://short.example.com/abc/9f0a',
    )
  })
})

describe('dataTables query parsing and HTML/Angular cell escaping', () => {
  it('normalizes out-of-range DataTables pagination and ordering parameters', () => {
    const parsed = parseDataTablesQuery(
      'https://short.example.com/api/v2/admin/get_admin_links?draw=-5&start=-10&length=9999&search%5Bvalue%5D=query&order%5B0%5D%5Bcolumn%5D=3&order%5B0%5D%5Bdir%5D=DESC',
    )
    expect(parsed).toEqual({
      draw: 1,
      start: 0,
      length: 200,
      searchValue: 'query',
      orderColumnIndex: 3,
      orderDirection: 'desc',
    })
  })

  it('escapes HTML entities, Angular interpolation, and single-quoted JS literals in DataTables cells', () => {
    expect(escapeHtmlEntities(`<script>"'&`)).toBe('&lt;script&gt;&quot;&#039;&amp;')
    expect(escapeSingleQuotedJsLiteralInHtmlAttribute(`https://example.com/a'b\\c`)).toBe(
      'https://example.com/a\\&#039;b\\\\c',
    )
    expect(truncateStringWithEllipsis('abcdef', 4)).toBe('abcd...')
    expect(formatUtcTimestamp(new Date('2026-10-27T14:05:09.000Z'))).toBe('2026-10-27 14:05:09')

    const sampleLink = {
      id: 1,
      shortUrl: 'slug1',
      longUrl: `https://example.com/?q={{7*7}}'"><script>`,
      createdIp: '127.0.0.1',
      creatorId: 1,
      creatorUsername: 'admin_user',
      clicks: 0,
      secretKey: null,
      isDisabled: false,
      isCustom: true,
      isApi: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }

    const longUrlCell = renderLongUrlCellHtml(sampleLink)
    expect(longUrlCell).toContain('ng-non-bindable')
    expect(longUrlCell).not.toContain('<script>')
    expect(longUrlCell).toContain(`editLongLink('slug1', 'https://example.com/?q={{7*7}}\\&#039;&quot;&gt;&lt;script&gt;')`)

    expect(renderToggleLinkActiveCellHtml({ ...sampleLink, isDisabled: false })).toContain('Disable')
    expect(renderToggleLinkActiveCellHtml({ ...sampleLink, isDisabled: true })).toContain('Enable')

    const apiActionCell = renderAdminApiActionCellHtml({
      id: 2,
      username: 'service_user',
      passwordHash: null,
      email: null,
      createdIp: null,
      role: 'user',
      isActive: true,
      apiKey: 'key-123',
      apiActive: true,
      apiQuota: 60,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    expect(apiActionCell).toContain(`openAPIModal($event, 'service_user', 'key-123', '1', '60', '2')`)
  })
})
