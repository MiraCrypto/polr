import type { CreateLinkParameters, CreateUserParameters, LinksRepository, UsersRepository } from '../src/db/repositories.js'
import type { DataTablesQueryParameters, DataTablesResponse, LinkRecord, UserRecord, UserRole } from '../src/domain/types.js'

const INITIAL_COUNTER_VALUE = 0

function createUniqueConstraintError(constraintName: string): Error & { code: string } {
  const uniqueError = new Error(
    `duplicate key value violates unique constraint "${constraintName}"`,
  ) as Error & { code: string }
  uniqueError.code = '23505'
  return uniqueError
}

function compareStringsCaseSensitive(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

function compareNullableStrings(left: string | null, right: string | null): number {
  if (left === null && right === null) {
    return 0
  }
  if (left === null) {
    return 1
  }
  if (right === null) {
    return -1
  }
  return compareStringsCaseSensitive(left, right)
}

export class InMemoryDatabaseState {
  public readonly users: UserRecord[] = []
  public readonly links: LinkRecord[] = []
  public nextUserId = 1
  public nextLinkId = 1
  public nextCounterValue = INITIAL_COUNTER_VALUE
}

export function createInMemoryRepositories(initialState?: Partial<{
  readonly users: readonly UserRecord[]
  readonly links: readonly LinkRecord[]
  readonly nextCounterValue: number
}>): {
  readonly state: InMemoryDatabaseState
  readonly usersRepository: UsersRepository
  readonly linksRepository: LinksRepository
} {
  const state = new InMemoryDatabaseState()
  if (initialState?.users !== undefined) {
    state.users.push(...initialState.users)
    const maxUserId = state.users.reduce((max, u) => Math.max(max, u.id), 0)
    state.nextUserId = maxUserId + 1
  }
  if (initialState?.links !== undefined) {
    state.links.push(...initialState.links)
    const maxLinkId = state.links.reduce((max, l) => Math.max(max, l.id), 0)
    state.nextLinkId = maxLinkId + 1
  }
  if (initialState?.nextCounterValue !== undefined) {
    state.nextCounterValue = initialState.nextCounterValue
  }

  const usersRepository: UsersRepository = {
    async findById(id: number, includeInactive: boolean = false): Promise<UserRecord | null> {
      const found = state.users.find(u => u.id === id && (includeInactive || u.isActive))
      return found ?? null
    },

    async findByUsername(username: string, includeInactive: boolean = false): Promise<UserRecord | null> {
      const found = state.users.find(u => u.username === username && (includeInactive || u.isActive))
      return found ?? null
    },

    async findActiveByApiKey(apiKey: string): Promise<UserRecord | null> {
      const found = state.users.find(u => u.apiKey === apiKey && u.isActive && u.apiActive)
      return found ?? null
    },

    async createUser(parameters: CreateUserParameters): Promise<UserRecord> {
      const existingUsername = state.users.find(u => u.username === parameters.username)
      if (existingUsername !== undefined) {
        throw createUniqueConstraintError('users_username_key')
      }
      if (
        parameters.apiKey !== null
        && state.users.some(u => u.apiKey === parameters.apiKey)
      ) {
        throw createUniqueConstraintError('users_api_key_key')
      }
      const now = new Date()
      const newUser: UserRecord = {
        id: state.nextUserId++,
        username: parameters.username,
        passwordHash: parameters.passwordHash,
        email: parameters.email,
        createdIp: parameters.createdIp,
        role: parameters.role,
        isActive: parameters.isActive,
        apiKey: parameters.apiKey,
        apiActive: parameters.apiActive,
        apiQuota: parameters.apiQuota,
        createdAt: now,
        updatedAt: now,
      }
      state.users.push(newUser)
      return newUser
    },

    async updatePasswordHash(userId: number, newPasswordHash: string): Promise<void> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing !== undefined) {
        state.users[index] = {
          ...existing,
          passwordHash: newPasswordHash,
          updatedAt: new Date(),
        }
      }
    },

    async toggleApiActive(userId: number): Promise<boolean | null> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing === undefined) {
        return null
      }
      const nextStatus = !existing.apiActive
      state.users[index] = {
        ...existing,
        apiActive: nextStatus,
        updatedAt: new Date(),
      }
      return nextStatus
    },

    async updateApiKey(userId: number, newApiKey: string): Promise<string | null> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing === undefined) {
        return null
      }
      if (state.users.some(u => u.id !== userId && u.apiKey === newApiKey)) {
        throw createUniqueConstraintError('users_api_key_key')
      }
      state.users[index] = {
        ...existing,
        apiKey: newApiKey,
        updatedAt: new Date(),
      }
      return newApiKey
    },

    async updateApiQuota(userId: number, newQuota: number): Promise<boolean> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing === undefined) {
        return false
      }
      state.users[index] = {
        ...existing,
        apiQuota: newQuota,
        updatedAt: new Date(),
      }
      return true
    },

    async toggleUserActive(userId: number): Promise<boolean | null> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing === undefined) {
        return null
      }
      const nextStatus = !existing.isActive
      state.users[index] = {
        ...existing,
        isActive: nextStatus,
        updatedAt: new Date(),
      }
      return nextStatus
    },

    async updateUserRole(userId: number, newRole: UserRole): Promise<boolean> {
      const index = state.users.findIndex(u => u.id === userId)
      const existing = state.users[index]
      if (existing === undefined) {
        return false
      }
      state.users[index] = {
        ...existing,
        role: newRole,
        updatedAt: new Date(),
      }
      return true
    },

    async deleteUser(userId: number): Promise<boolean> {
      const index = state.users.findIndex(u => u.id === userId)
      if (index === -1) {
        return false
      }
      state.users.splice(index, 1)
      for (let linkIndex = 0; linkIndex < state.links.length; linkIndex++) {
        const link = state.links[linkIndex]
        if (link !== undefined && link.creatorId === userId) {
          state.links[linkIndex] = {
            ...link,
            creatorId: null,
            creatorUsername: null,
          }
        }
      }
      return true
    },

    async paginateAdminUsers(query: DataTablesQueryParameters): Promise<DataTablesResponse<UserRecord>> {
      const searchLower = query.searchValue.trim().toLowerCase()
      const filtered = searchLower.length === 0
        ? [...state.users]
        : state.users.filter(
            u =>
              u.username.toLowerCase().includes(searchLower)
              || (u.email ?? '').toLowerCase().includes(searchLower),
          )

      const directionMultiplier = query.orderDirection === 'desc'
        ? -1
        : 1
      filtered.sort((left, right) => {
        let comparison = 0
        if (query.orderColumnIndex === 1) {
          comparison = compareNullableStrings(left.email, right.email)
        }
        else if (query.orderColumnIndex === 2) {
          comparison = left.createdAt.getTime() - right.createdAt.getTime()
        }
        else {
          comparison = compareStringsCaseSensitive(left.username, right.username)
        }
        if (comparison !== 0) {
          return comparison * directionMultiplier
        }
        return left.id - right.id
      })

      const sliced = filtered.slice(query.start, query.start + query.length)
      return {
        draw: query.draw,
        recordsTotal: state.users.length,
        recordsFiltered: filtered.length,
        data: sliced,
      }
    },
  }

  function sortLinksForDataTables(
    links: LinkRecord[],
    orderColumnIndex: number,
    orderDirection: 'asc' | 'desc',
    allowCreatorSort: boolean,
  ): void {
    const directionMultiplier = orderDirection === 'desc'
      ? -1
      : 1
    links.sort((left, right) => {
      let comparison = 0
      if (orderColumnIndex === 0) {
        comparison = compareStringsCaseSensitive(left.shortUrl, right.shortUrl)
      }
      else if (orderColumnIndex === 1) {
        comparison = compareStringsCaseSensitive(left.longUrl, right.longUrl)
      }
      else if (orderColumnIndex === 2) {
        comparison = left.clicks - right.clicks
      }
      else if (allowCreatorSort && orderColumnIndex === 4) {
        comparison = compareNullableStrings(left.creatorUsername, right.creatorUsername)
      }
      else {
        comparison = left.createdAt.getTime() - right.createdAt.getTime()
      }
      if (comparison !== 0) {
        return comparison * directionMultiplier
      }
      return right.id - left.id
    })
  }

  const linksRepository: LinksRepository = {
    async findByShortUrl(
      shortUrl: string,
      allowCaseInsensitiveCustomFallback: boolean = false,
    ): Promise<LinkRecord | null> {
      const exact = state.links.find(l => l.shortUrl === shortUrl)
      if (exact !== undefined) {
        return exact
      }
      if (!allowCaseInsensitiveCustomFallback) {
        return null
      }
      const lowerTarget = shortUrl.toLowerCase()
      const fallback = state.links.find(
        l => l.isCustom && l.shortUrl.toLowerCase() === lowerTarget,
      )
      return fallback ?? null
    },

    async findExistingNonCustomLink(longUrl: string, creatorId: number | null): Promise<LinkRecord | null> {
      const matches = state.links
        .filter(
          l =>
            l.longUrl === longUrl
            && l.creatorId === creatorId
            && !l.isCustom
            && (l.secretKey === null || l.secretKey === ''),
        )
        .sort((left, right) => right.id - left.id)
      return matches[0] ?? null
    },

    async allocateNextCounterValue(): Promise<number> {
      return state.nextCounterValue++
    },

    async createLink(parameters: CreateLinkParameters): Promise<LinkRecord> {
      const existingShort = state.links.find(l => l.shortUrl === parameters.shortUrl)
      if (existingShort !== undefined) {
        throw createUniqueConstraintError('links_short_url_key')
      }
      const now = new Date()
      const creator = parameters.creatorId !== null
        ? state.users.find(u => u.id === parameters.creatorId) ?? null
        : null
      const newLink: LinkRecord = {
        id: state.nextLinkId++,
        shortUrl: parameters.shortUrl,
        longUrl: parameters.longUrl,
        createdIp: parameters.createdIp,
        creatorId: parameters.creatorId,
        creatorUsername: creator?.username ?? null,
        clicks: 0,
        secretKey: parameters.secretKey,
        isDisabled: false,
        isCustom: parameters.isCustom,
        isApi: parameters.isApi,
        createdAt: now,
        updatedAt: now,
      }
      state.links.push(newLink)
      return newLink
    },

    async incrementClicks(linkId: number): Promise<void> {
      const index = state.links.findIndex(l => l.id === linkId)
      const existing = state.links[index]
      if (existing !== undefined) {
        state.links[index] = {
          ...existing,
          clicks: existing.clicks + 1,
          updatedAt: new Date(),
        }
      }
    },

    async toggleLinkDisabled(shortUrl: string): Promise<boolean | null> {
      const index = state.links.findIndex(l => l.shortUrl === shortUrl)
      const existing = state.links[index]
      if (existing === undefined) {
        return null
      }
      const nextDisabled = !existing.isDisabled
      state.links[index] = {
        ...existing,
        isDisabled: nextDisabled,
        updatedAt: new Date(),
      }
      return nextDisabled
    },

    async updateLongUrl(shortUrl: string, newLongUrl: string): Promise<boolean> {
      const index = state.links.findIndex(l => l.shortUrl === shortUrl)
      const existing = state.links[index]
      if (existing === undefined) {
        return false
      }
      state.links[index] = {
        ...existing,
        longUrl: newLongUrl,
        updatedAt: new Date(),
      }
      return true
    },

    async deleteLink(shortUrl: string): Promise<boolean> {
      const index = state.links.findIndex(l => l.shortUrl === shortUrl)
      if (index === -1) {
        return false
      }
      state.links.splice(index, 1)
      return true
    },

    async countRecentApiLinksByCreator(creatorId: number, sinceTimestamp: Date): Promise<number> {
      return state.links.filter(
        l => l.creatorId === creatorId && l.isApi && l.createdAt >= sinceTimestamp,
      ).length
    },

    async paginateAdminLinks(query: DataTablesQueryParameters): Promise<DataTablesResponse<LinkRecord>> {
      const searchLower = query.searchValue.trim().toLowerCase()
      const filtered = searchLower.length === 0
        ? [...state.links]
        : state.links.filter(
            l =>
              l.shortUrl.toLowerCase().includes(searchLower)
              || l.longUrl.toLowerCase().includes(searchLower)
              || (l.creatorUsername ?? '').toLowerCase().includes(searchLower),
          )
      sortLinksForDataTables(filtered, query.orderColumnIndex, query.orderDirection, true)
      const sliced = filtered.slice(query.start, query.start + query.length)
      return {
        draw: query.draw,
        recordsTotal: state.links.length,
        recordsFiltered: filtered.length,
        data: sliced,
      }
    },

    async paginateUserLinks(
      creatorId: number,
      query: DataTablesQueryParameters,
    ): Promise<DataTablesResponse<LinkRecord>> {
      const userOwned = state.links.filter(l => l.creatorId === creatorId)
      const searchLower = query.searchValue.trim().toLowerCase()
      const filtered = searchLower.length === 0
        ? [...userOwned]
        : userOwned.filter(
            l =>
              l.shortUrl.toLowerCase().includes(searchLower)
              || l.longUrl.toLowerCase().includes(searchLower),
          )
      sortLinksForDataTables(filtered, query.orderColumnIndex, query.orderDirection, false)
      const sliced = filtered.slice(query.start, query.start + query.length)
      return {
        draw: query.draw,
        recordsTotal: userOwned.length,
        recordsFiltered: filtered.length,
        data: sliced,
      }
    },
  }

  return { state, usersRepository, linksRepository }
}
