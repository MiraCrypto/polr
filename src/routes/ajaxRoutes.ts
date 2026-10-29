import type { Context, Hono } from 'hono'
import type { ApplicationDependencies } from '../app.js'
import type { UserRecord } from '../domain/types.js'
import { generateRandomHexString, hashPasswordWithBcrypt } from '../domain/authService.js'
import {
  isDatabaseUniqueConstraintViolation,
  isReservedRouteEnding,
  isValidEndingSyntax,
  isValidHttpUrl,
} from '../domain/linkService.js'
import { fromLegacyWireRole } from '../domain/types.js'
import {
  formatAdminLinksDataTableResponse,
  formatAdminUsersDataTableResponse,
  formatUserLinksDataTableResponse,
  parseDataTablesQuery,
} from '../views/dataTables.js'
import {
  extractClientIpAddress,
  parseRequestFormOrJsonFields,
  resolveCurrentUser,
  verifyCsrfTokenFromRequest,
} from './requestContext.js'

const DEFAULT_NEW_USER_API_QUOTA = 60

export function registerAjaxRoutes(app: Hono, dependencies: ApplicationDependencies): void {
  const { config, usersRepository, linksRepository } = dependencies

  async function requireAdminPostRequest(
    context: Context,
  ): Promise<{ readonly adminUser: UserRecord, readonly fields: Record<string, string> } | Response> {
    const { user, session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      return context.text('403 Invalid CSRF token.', 403)
    }
    if (user === null || user.role !== 'admin') {
      return context.text('401 User not admin.', 401)
    }
    return { adminUser: user, fields }
  }

  app.post('/api/v2/link_avail_check', async (context) => {
    const { session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      return context.text('403 Invalid CSRF token.', 403)
    }

    const linkEnding = fields['link_ending']?.trim() ?? ''
    if (!isValidEndingSyntax(linkEnding)) {
      return context.text('invalid')
    }

    if (isReservedRouteEnding(linkEnding)) {
      return context.text('unavailable')
    }

    const existingLink = await linksRepository.findByShortUrl(linkEnding, true)
    return context.text(existingLink !== null
      ? 'unavailable'
      : 'available')
  })

  app.get('/api/v2/admin/get_admin_users', async (context) => {
    const { user } = await resolveCurrentUser(context, config, usersRepository)
    if (user === null || user.role !== 'admin') {
      return context.text('401 User not admin.', 401)
    }

    const query = parseDataTablesQuery(context.req.url)
    const paginatedUsers = await usersRepository.paginateAdminUsers(query)
    return context.json(formatAdminUsersDataTableResponse(paginatedUsers, user.username))
  })

  app.get('/api/v2/admin/get_admin_links', async (context) => {
    const { user } = await resolveCurrentUser(context, config, usersRepository)
    if (user === null || user.role !== 'admin') {
      return context.text('401 User not admin.', 401)
    }

    const query = parseDataTablesQuery(context.req.url)
    const paginatedLinks = await linksRepository.paginateAdminLinks(query)
    return context.json(formatAdminLinksDataTableResponse(paginatedLinks))
  })

  app.get('/api/v2/admin/get_user_links', async (context) => {
    const { user } = await resolveCurrentUser(context, config, usersRepository)
    if (user === null) {
      return context.text('401 User must be authenticated.', 401)
    }

    const query = parseDataTablesQuery(context.req.url)
    const paginatedLinks = await linksRepository.paginateUserLinks(user.id, query)
    return context.json(formatUserLinksDataTableResponse(paginatedLinks))
  })

  app.post('/api/v2/admin/toggle_api_active', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const targetUserId = Number.parseInt(auth.fields['user_id'] ?? '', 10)
    if (Number.isNaN(targetUserId)) {
      return context.text('404 User not found.', 404)
    }

    const newStatus = await usersRepository.toggleApiActive(targetUserId)
    if (newStatus === null) {
      return context.text('404 User not found.', 404)
    }

    return context.text(newStatus ? '1' : '0')
  })

  app.post('/api/v2/admin/generate_new_api_key', async (context) => {
    const { user, session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      return context.text('403 Invalid CSRF token.', 403)
    }
    if (user === null) {
      return context.text('401 User not admin.', 401)
    }

    const targetUserId = Number.parseInt(fields['user_id'] ?? '', 10)
    if (Number.isNaN(targetUserId)) {
      return context.text('404 User not found.', 404)
    }

    const targetUser = await usersRepository.findById(targetUserId, true)
    if (targetUser === null) {
      return context.text('404 User not found.', 404)
    }

    // AdminCtrl.js invokes this endpoint from both the admin modal and the non-admin Developer tab
    const isAuthorizedSelfReset = targetUser.id === user.id && targetUser.apiActive
    if (user.role !== 'admin' && !isAuthorizedSelfReset) {
      return context.text('401 User not admin.', 401)
    }

    const newApiKey = generateRandomHexString(config.apiKeyByteLength)
    await usersRepository.updateApiKey(targetUser.id, newApiKey)
    return context.text(newApiKey)
  })

  app.post('/api/v2/admin/edit_api_quota', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const targetUserId = Number.parseInt(auth.fields['user_id'] ?? '', 10)
    const newQuota = Number.parseInt(auth.fields['new_quota'] ?? '', 10)
    if (Number.isNaN(targetUserId) || Number.isNaN(newQuota)) {
      return context.text('404 User not found.', 404)
    }
    if (newQuota < -1) {
      return context.text('400 Invalid API quota.', 400)
    }

    const updated = await usersRepository.updateApiQuota(targetUserId, newQuota)
    if (!updated) {
      return context.text('404 User not found.', 404)
    }

    return context.text('OK')
  })

  app.post('/api/v2/admin/toggle_user_active', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const targetUserId = Number.parseInt(auth.fields['user_id'] ?? '', 10)
    if (Number.isNaN(targetUserId)) {
      return context.text('404 User not found.', 404)
    }
    if (targetUserId === auth.adminUser.id) {
      return context.text('400 Cannot modify own account.', 400)
    }

    const newStatus = await usersRepository.toggleUserActive(targetUserId)
    if (newStatus === null) {
      return context.text('404 User not found.', 404)
    }

    return context.text(newStatus ? '1' : '0')
  })

  app.post('/api/v2/admin/change_user_role', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const targetUserId = Number.parseInt(auth.fields['user_id'] ?? '', 10)
    if (Number.isNaN(targetUserId)) {
      return context.text('404 User not found.', 404)
    }
    if (targetUserId === auth.adminUser.id) {
      return context.text('400 Cannot modify own account.', 400)
    }

    const newRole = fromLegacyWireRole(auth.fields['role'] ?? '')
    const updated = await usersRepository.updateUserRole(targetUserId, newRole)
    if (!updated) {
      return context.text('404 User not found.', 404)
    }

    return context.text('OK')
  })

  app.post('/api/v2/admin/add_new_user', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const username = auth.fields['username']?.trim() ?? ''
    const password = auth.fields['user_password'] ?? ''
    const email = auth.fields['user_email']?.trim() ?? ''
    const role = fromLegacyWireRole(auth.fields['user_role'] ?? '')

    if (username.length === 0 || password.length === 0 || !isValidEndingSyntax(username)) {
      return context.text('400 Invalid user parameters.', 400)
    }

    const existingUser = await usersRepository.findByUsername(username, true)
    if (existingUser !== null) {
      return context.text('409 User already exists.', 409)
    }

    const passwordHash = await hashPasswordWithBcrypt(password)
    try {
      await usersRepository.createUser({
        username,
        passwordHash,
        email: email.length > 0
          ? email
          : null,
        createdIp: extractClientIpAddress(context),
        role,
        isActive: true,
        apiKey: null,
        apiActive: false,
        apiQuota: DEFAULT_NEW_USER_API_QUOTA,
      })
    }
    catch (error) {
      if (isDatabaseUniqueConstraintViolation(error)) {
        return context.text('409 User already exists.', 409)
      }
      throw error
    }

    return context.text('OK')
  })

  app.post('/api/v2/admin/delete_user', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const targetUserId = Number.parseInt(auth.fields['user_id'] ?? '', 10)
    if (Number.isNaN(targetUserId)) {
      return context.text('404 User not found.', 404)
    }
    if (targetUserId === auth.adminUser.id) {
      return context.text('400 Cannot modify own account.', 400)
    }

    const deleted = await usersRepository.deleteUser(targetUserId)
    if (!deleted) {
      return context.text('404 User not found.', 404)
    }

    return context.text('OK')
  })

  app.post('/api/v2/admin/delete_link', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const linkEnding = auth.fields['link_ending']?.trim() ?? ''
    const deleted = await linksRepository.deleteLink(linkEnding)
    if (!deleted) {
      return context.text('404 Link not found.', 404)
    }

    return context.text('OK')
  })

  app.post('/api/v2/admin/toggle_link', async (context) => {
    const auth = await requireAdminPostRequest(context)
    if (auth instanceof Response) {
      return auth
    }

    const linkEnding = auth.fields['link_ending']?.trim() ?? ''
    const isNowDisabled = await linksRepository.toggleLinkDisabled(linkEnding)
    if (isNowDisabled === null) {
      return context.text('404 Link not found.', 404)
    }

    // AdminCtrl.js assigns the response directly to the toggle button text (the next action label)
    return context.text(isNowDisabled ? 'Enable' : 'Disable')
  })

  app.post('/api/v2/admin/edit_link_long_url', async (context) => {
    const { user, session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      return context.text('403 Invalid CSRF token.', 403)
    }
    if (user === null) {
      return context.text('401 User must be authenticated.', 401)
    }

    const linkEnding = fields['link_ending']?.trim() ?? ''
    const newLongUrl = fields['new_long_url']?.trim() ?? ''
    if (!isValidHttpUrl(newLongUrl)) {
      return context.text('422 Invalid URL.', 422)
    }

    const existingLink = await linksRepository.findByShortUrl(linkEnding, false)
    if (existingLink === null) {
      return context.text('404 Link not found.', 404)
    }

    if (existingLink.creatorId !== user.id && user.role !== 'admin') {
      return context.text('401 User not admin.', 401)
    }

    await linksRepository.updateLongUrl(linkEnding, newLongUrl)
    return context.text('OK')
  })
}
