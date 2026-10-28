import type { DataTablesQueryParameters, DataTablesResponse, LinkRecord, UserRecord, UserRole } from '../domain/types.js'

export interface CreateUserParameters {
  readonly username: string
  readonly passwordHash: string | null
  readonly email: string | null
  readonly createdIp: string | null
  readonly role: UserRole
  readonly isActive: boolean
  readonly apiKey: string | null
  readonly apiActive: boolean
  readonly apiQuota: number
}

export interface CreateLinkParameters {
  readonly shortUrl: string
  readonly longUrl: string
  readonly createdIp: string
  readonly creatorId: number | null
  readonly secretKey: string | null
  readonly isCustom: boolean
  readonly isApi: boolean
}

export interface UsersRepository {
  findById: (id: number, includeInactive?: boolean) => Promise<UserRecord | null>
  findByUsername: (username: string, includeInactive?: boolean) => Promise<UserRecord | null>
  findActiveByApiKey: (apiKey: string) => Promise<UserRecord | null>
  createUser: (parameters: CreateUserParameters) => Promise<UserRecord>
  updatePasswordHash: (userId: number, newPasswordHash: string) => Promise<void>
  toggleApiActive: (userId: number) => Promise<boolean | null>
  updateApiKey: (userId: number, newApiKey: string) => Promise<string | null>
  updateApiQuota: (userId: number, newQuota: number) => Promise<boolean>
  toggleUserActive: (userId: number) => Promise<boolean | null>
  updateUserRole: (userId: number, newRole: UserRole) => Promise<boolean>
  deleteUser: (userId: number) => Promise<boolean>
  paginateAdminUsers: (query: DataTablesQueryParameters) => Promise<DataTablesResponse<UserRecord>>
}

export interface LinksRepository {
  findByShortUrl: (shortUrl: string, allowCaseInsensitiveCustomFallback?: boolean) => Promise<LinkRecord | null>
  findExistingNonCustomLink: (longUrl: string, creatorId: number | null) => Promise<LinkRecord | null>
  allocateNextCounterValue: () => Promise<number>
  createLink: (parameters: CreateLinkParameters) => Promise<LinkRecord>
  incrementClicks: (linkId: number) => Promise<void>
  toggleLinkDisabled: (shortUrl: string) => Promise<boolean | null>
  updateLongUrl: (shortUrl: string, newLongUrl: string) => Promise<boolean>
  deleteLink: (shortUrl: string) => Promise<boolean>
  countRecentApiLinksByCreator: (creatorId: number, sinceTimestamp: Date) => Promise<number>
  paginateAdminLinks: (query: DataTablesQueryParameters) => Promise<DataTablesResponse<LinkRecord>>
  paginateUserLinks: (creatorId: number, query: DataTablesQueryParameters) => Promise<DataTablesResponse<LinkRecord>>
}
