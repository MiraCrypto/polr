export type UserRole = 'user' | 'admin'

export type LegacyWireRole = '' | 'admin'

export type FlashMessageType = 'info' | 'error' | 'warning' | 'success'

export interface FlashMessage {
  readonly type: FlashMessageType
  readonly message: string
}

export interface SessionPayload {
  readonly userId: number
  readonly username: string
  readonly role: UserRole
  readonly csrfToken: string
  readonly issuedAtEpochSeconds: number
}

export interface UserRecord {
  readonly id: number
  readonly username: string
  readonly passwordHash: string | null
  readonly email: string | null
  readonly createdIp: string | null
  readonly role: UserRole
  readonly isActive: boolean
  readonly apiKey: string | null
  readonly apiActive: boolean
  readonly apiQuota: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface LinkRecord {
  readonly id: number
  readonly shortUrl: string
  readonly longUrl: string
  readonly createdIp: string
  readonly creatorId: number | null
  readonly creatorUsername: string | null
  readonly clicks: number
  readonly secretKey: string | null
  readonly isDisabled: boolean
  readonly isCustom: boolean
  readonly isApi: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface DataTablesQueryParameters {
  readonly draw: number
  readonly start: number
  readonly length: number
  readonly searchValue: string
  readonly orderColumnIndex: number
  readonly orderDirection: 'asc' | 'desc'
}

export interface DataTablesResponse<TRow> {
  readonly draw: number
  readonly recordsTotal: number
  readonly recordsFiltered: number
  readonly data: readonly TRow[]
}

export function toLegacyWireRole(role: UserRole): LegacyWireRole {
  return role === 'admin'
    ? 'admin'
    : ''
}

export function fromLegacyWireRole(wireRole: string): UserRole {
  return wireRole === 'admin'
    ? 'admin'
    : 'user'
}
