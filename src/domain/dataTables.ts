import type { DataTablesQueryParameters, DataTablesResponse, LinkRecord, UserRecord } from './types.js'
import { toLegacyWireRole } from './types.js'

const DEFAULT_PAGE_LENGTH = 10
const MAX_PAGE_LENGTH = 200
const LONG_URL_DISPLAY_CHARACTER_LIMIT = 50

export function escapeHtmlEntities(rawText: string): string {
  return rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function escapeSingleQuotedJsLiteralInHtmlAttribute(rawText: string): string {
  const jsEscaped = rawText
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  return escapeHtmlEntities(jsEscaped)
}

export function truncateStringWithEllipsis(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value
  }
  return `${value.slice(0, maximumLength)}...`
}

export function formatUtcTimestamp(date: Date): string {
  const isoString = date.toISOString()
  return `${isoString.slice(0, 10)} ${isoString.slice(11, 19)}`
}

export function parseDataTablesQuery(requestUrl: string): DataTablesQueryParameters {
  const parsedUrl = new URL(requestUrl, 'http://localhost')
  const searchParams = parsedUrl.searchParams

  const rawDraw = Number.parseInt(searchParams.get('draw') ?? '1', 10)
  const rawStart = Number.parseInt(searchParams.get('start') ?? '0', 10)
  const rawLength = Number.parseInt(searchParams.get('length') ?? String(DEFAULT_PAGE_LENGTH), 10)
  const rawOrderCol = Number.parseInt(searchParams.get('order[0][column]') ?? '0', 10)
  const rawOrderDir = (searchParams.get('order[0][dir]') ?? 'asc').toLowerCase()

  return {
    draw: Number.isNaN(rawDraw) || rawDraw < 0
      ? 1
      : rawDraw,
    start: Number.isNaN(rawStart) || rawStart < 0
      ? 0
      : rawStart,
    length:
      Number.isNaN(rawLength) || rawLength <= 0
        ? DEFAULT_PAGE_LENGTH
        : Math.min(rawLength, MAX_PAGE_LENGTH),
    searchValue: searchParams.get('search[value]') ?? '',
    orderColumnIndex: Number.isNaN(rawOrderCol) || rawOrderCol < 0
      ? 0
      : rawOrderCol,
    orderDirection: rawOrderDir === 'desc'
      ? 'desc'
      : 'asc',
  }
}

export function renderLongUrlCellHtml(link: LinkRecord): string {
  const escapedHref = escapeHtmlEntities(link.longUrl)
  const escapedDisplayText = escapeHtmlEntities(
    truncateStringWithEllipsis(link.longUrl, LONG_URL_DISPLAY_CHARACTER_LIMIT),
  )
  const escapedShortJs = escapeSingleQuotedJsLiteralInHtmlAttribute(link.shortUrl)
  const escapedLongJs = escapeSingleQuotedJsLiteralInHtmlAttribute(link.longUrl)

  return `<a target="_blank" ng-non-bindable title="${escapedHref}" href="${escapedHref}">${escapedDisplayText}</a>
            <a class="btn btn-primary btn-xs edit-long-link-btn" ng-click="editLongLink('${escapedShortJs}', '${escapedLongJs}')"><i class="fa fa-edit edit-link-icon"></i></a>`
}

export function renderToggleLinkActiveCellHtml(link: LinkRecord): string {
  const buttonColorClass = link.isDisabled ? 'btn-success' : 'btn-danger'
  const buttonText = link.isDisabled ? 'Enable' : 'Disable'
  const escapedShortJs = escapeSingleQuotedJsLiteralInHtmlAttribute(link.shortUrl)

  return `<a ng-click="toggleLink($event, '${escapedShortJs}')" class="btn btn-sm ${buttonColorClass}">
            ${buttonText}
        </a>`
}

export function renderDeleteLinkCellHtml(link: LinkRecord): string {
  const escapedShortJs = escapeSingleQuotedJsLiteralInHtmlAttribute(link.shortUrl)
  return `<a ng-click="deleteLink($event, '${escapedShortJs}')"
            class="btn btn-sm btn-warning delete-link">
            Delete
        </a>`
}

export function renderAdminApiActionCellHtml(user: UserRecord): string {
  const escapedUsername = escapeSingleQuotedJsLiteralInHtmlAttribute(user.username)
  const escapedApiKey = escapeSingleQuotedJsLiteralInHtmlAttribute(user.apiKey ?? '')
  const apiActiveNumeric = user.apiActive ? '1' : '0'
  const escapedQuota = escapeSingleQuotedJsLiteralInHtmlAttribute(String(user.apiQuota))

  return `<a class="activate-api-modal btn btn-sm btn-info"
            ng-click="openAPIModal($event, '${escapedUsername}', '${escapedApiKey}', '${apiActiveNumeric}', '${escapedQuota}', '${user.id}')">
            API info
        </a>`
}

export function renderToggleUserActiveCellHtml(user: UserRecord, currentUsername: string): string {
  const disabledClass = currentUsername === user.username
    ? ' disabled'
    : ''
  const activeText = user.isActive ? 'Active' : 'Inactive'
  const colorClass = user.isActive ? ' btn-success' : ' btn-danger'

  return `<a class="btn btn-sm status-display${colorClass}${disabledClass}" ng-click="toggleUserActiveStatus($event, ${user.id})">${activeText}</a>`
}

export function renderChangeUserRoleCellHtml(user: UserRecord, currentUsername: string): string {
  const wireRole = toLegacyWireRole(user.role)
  const disabledAttribute = currentUsername === user.username
    ? ' disabled'
    : ''
  const adminSelected = wireRole === 'admin'
    ? ' selected'
    : ''
  const defaultSelected = wireRole === ''
    ? ' selected'
    : ''

  return `<select ng-init="changeUserRole.u${user.id} = '${wireRole}'"
            ng-model="changeUserRole.u${user.id}" ng-change="changeUserRole(changeUserRole.u${user.id}, ${user.id})"
            class="form-control"${disabledAttribute}><option value="admin"${adminSelected}>admin</option><option value=""${defaultSelected}>default</option></select>`
}

export function renderDeleteUserCellHtml(user: UserRecord, currentUsername: string): string {
  const disabledClass = currentUsername === user.username
    ? 'disabled'
    : ''
  return `<a ng-click="deleteUser($event, '${user.id}')" class="btn btn-sm btn-danger ${disabledClass}">
            Delete
        </a>`
}

export interface AdminUserDataTableRow {
  readonly username: string
  readonly email: string
  readonly created_at: string
  readonly toggle_active: string
  readonly api_action: string
  readonly change_role: string
  readonly delete: string
}

export interface AdminLinkDataTableRow {
  readonly short_url: string
  readonly long_url: string
  readonly clicks: number
  readonly created_at: string
  readonly creator: string
  readonly disable: string
  readonly delete: string
}

export interface UserLinkDataTableRow {
  readonly id: number
  readonly short_url: string
  readonly long_url: string
  readonly clicks: number
  readonly created_at: string
}

export function formatAdminUsersDataTableResponse(
  paginatedUsers: DataTablesResponse<UserRecord>,
  currentUsername: string,
): DataTablesResponse<AdminUserDataTableRow> {
  return {
    draw: paginatedUsers.draw,
    recordsTotal: paginatedUsers.recordsTotal,
    recordsFiltered: paginatedUsers.recordsFiltered,
    data: paginatedUsers.data.map(user => ({
      username: escapeHtmlEntities(user.username),
      email: escapeHtmlEntities(user.email ?? ''),
      created_at: formatUtcTimestamp(user.createdAt),
      toggle_active: renderToggleUserActiveCellHtml(user, currentUsername),
      api_action: renderAdminApiActionCellHtml(user),
      change_role: renderChangeUserRoleCellHtml(user, currentUsername),
      delete: renderDeleteUserCellHtml(user, currentUsername),
    })),
  }
}

export function formatAdminLinksDataTableResponse(
  paginatedLinks: DataTablesResponse<LinkRecord>,
): DataTablesResponse<AdminLinkDataTableRow> {
  return {
    draw: paginatedLinks.draw,
    recordsTotal: paginatedLinks.recordsTotal,
    recordsFiltered: paginatedLinks.recordsFiltered,
    data: paginatedLinks.data.map(link => ({
      short_url: escapeHtmlEntities(link.shortUrl),
      long_url: renderLongUrlCellHtml(link),
      clicks: link.clicks,
      created_at: formatUtcTimestamp(link.createdAt),
      creator: escapeHtmlEntities(link.creatorUsername ?? ''),
      disable: renderToggleLinkActiveCellHtml(link),
      delete: renderDeleteLinkCellHtml(link),
    })),
  }
}

export function formatUserLinksDataTableResponse(
  paginatedLinks: DataTablesResponse<LinkRecord>,
): DataTablesResponse<UserLinkDataTableRow> {
  return {
    draw: paginatedLinks.draw,
    recordsTotal: paginatedLinks.recordsTotal,
    recordsFiltered: paginatedLinks.recordsFiltered,
    data: paginatedLinks.data.map(link => ({
      id: link.id,
      short_url: escapeHtmlEntities(link.shortUrl),
      long_url: renderLongUrlCellHtml(link),
      clicks: link.clicks,
      created_at: formatUtcTimestamp(link.createdAt),
    })),
  }
}
