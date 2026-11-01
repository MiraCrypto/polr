import type { Context, Hono } from 'hono'
import type { ApplicationDependencies } from '../app.js'
import {
  constantTimeStringEqual,
  hashPasswordWithBcrypt,
  verifyPasswordWithBcrypt,
} from '../domain/authService.js'
import {
  createShortenedLink,
  isValidEndingSyntax,
  isValidHttpUrl,
  LinkValidationError,
} from '../domain/linkService.js'
import {
  renderAboutPage,
  renderAdminDashboardPage,
  renderErrorPage,
  renderIndexPage,
  renderLoginPage,
  renderNotFoundPage,
  renderShortenResultPage,
} from '../views/pages.js'
import {
  buildPageRenderContext,
  clearUserSessionCookie,
  extractClientIpAddress,
  parseRequestFormOrJsonFields,
  resolveCurrentUser,
  setFlashMessageCookie,
  setSignedUserSessionCookie,
  verifyCsrfTokenFromRequest,
} from './requestContext.js'

export function registerWebRoutes(app: Hono, dependencies: ApplicationDependencies): void {
  const { config, usersRepository, linksRepository, logError } = dependencies

  app.get('/', async (context) => {
    const pageContext = await buildPageRenderContext(context, config, usersRepository)
    if (!config.publicInterfaceEnabled && pageContext.currentUser === null) {
      if (config.indexRedirectUrl.length > 0) {
        return context.redirect(config.indexRedirectUrl, 302)
      }
      return context.redirect('/login', 302)
    }

    return context.html(renderIndexPage(pageContext))
  })

  app.get('/login', async (context) => {
    const pageContext = await buildPageRenderContext(context, config, usersRepository)
    if (pageContext.currentUser !== null) {
      return context.redirect('/', 302)
    }

    return context.html(renderLoginPage(pageContext))
  })

  app.post('/login', async (context) => {
    const { session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      setFlashMessageCookie(context, config, 'error', 'Invalid CSRF token. Please try again.')
      return context.redirect('/login', 302)
    }

    const username = fields['username']?.trim() ?? ''
    const password = fields['password'] ?? ''

    const user = await usersRepository.findByUsername(username, false)
    const isPasswordValid = user !== null
      ? await verifyPasswordWithBcrypt(password, user.passwordHash)
      : false

    if (user === null || !isPasswordValid) {
      setFlashMessageCookie(
        context,
        config,
        'error',
        'Invalid password or inactivated account. Try again.',
      )
      return context.redirect('/login', 302)
    }

    setSignedUserSessionCookie(context, config, user)
    return context.redirect('/', 302)
  })

  app.get('/logout', (context) => {
    clearUserSessionCookie(context, config)
    return context.redirect('/', 302)
  })

  app.get('/about-polr', async (context) => {
    const pageContext = await buildPageRenderContext(context, config, usersRepository)
    return context.html(renderAboutPage(pageContext))
  })

  app.get('/admin', async (context) => {
    const pageContext = await buildPageRenderContext(context, config, usersRepository)
    if (pageContext.currentUser === null) {
      setFlashMessageCookie(
        context,
        config,
        'error',
        'Please login to access your dashboard.',
      )
      return context.redirect('/login', 302)
    }

    return context.html(renderAdminDashboardPage(pageContext, pageContext.currentUser))
  })

  app.post('/admin/action/change_password', async (context) => {
    const { user, session } = await resolveCurrentUser(context, config, usersRepository)
    if (user === null) {
      const pageContext = await buildPageRenderContext(context, config, usersRepository)
      return context.html(renderNotFoundPage(pageContext), 404)
    }

    const fields = await parseRequestFormOrJsonFields(context)
    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      setFlashMessageCookie(context, config, 'error', 'Invalid CSRF token. Please try again.')
      return context.redirect('/admin', 302)
    }

    const currentPassword = fields['current_password'] ?? ''
    const newPassword = fields['new_password'] ?? ''

    const isPasswordValid = await verifyPasswordWithBcrypt(currentPassword, user.passwordHash)
    if (!isPasswordValid || newPassword.length === 0) {
      setFlashMessageCookie(context, config, 'error', 'Current password invalid. Try again.')
      return context.redirect('/admin', 302)
    }

    const newPasswordHash = await hashPasswordWithBcrypt(newPassword)
    await usersRepository.updatePasswordHash(user.id, newPasswordHash)
    setFlashMessageCookie(context, config, 'success', 'Password changed successfully.')
    return context.redirect('/admin', 302)
  })

  app.post('/shorten', async (context) => {
    const { user, session } = await resolveCurrentUser(context, config, usersRepository)
    const fields = await parseRequestFormOrJsonFields(context)

    if (!verifyCsrfTokenFromRequest(context, session, fields['_token'])) {
      setFlashMessageCookie(context, config, 'error', 'Invalid CSRF token. Please try again.')
      return context.redirect('/', 302)
    }

    if (config.shortenRequiresLogin && user === null) {
      setFlashMessageCookie(
        context,
        config,
        'error',
        'You must be logged in to shorten links.',
      )
      return context.redirect('/', 302)
    }

    const longUrl = fields['link-url']?.trim() ?? ''
    const customEnding = fields['custom-ending']?.trim() ?? ''
    const isSecret = fields['options'] === 's'

    if (!isValidHttpUrl(longUrl)) {
      setFlashMessageCookie(context, config, 'error', 'The link-url format is invalid.')
      return context.redirect('/', 302)
    }

    if (customEnding.length > 0 && !isValidEndingSyntax(customEnding)) {
      setFlashMessageCookie(
        context,
        config,
        'error',
        'The custom-ending may only contain letters, numbers, and dashes.',
      )
      return context.redirect('/', 302)
    }

    try {
      const shortenedUrl = await createShortenedLink(linksRepository, config, {
        longUrl,
        isSecret,
        customEnding: customEnding.length > 0
          ? customEnding
          : null,
        createdIp: extractClientIpAddress(context),
        creatorId: user?.id ?? null,
        isApi: false,
      })

      const pageContext = await buildPageRenderContext(context, config, usersRepository)
      return context.html(renderShortenResultPage(pageContext, shortenedUrl))
    }
    catch (error) {
      const errorMessage = error instanceof LinkValidationError
        ? error.message
        : 'Unable to shorten URL.'
      setFlashMessageCookie(context, config, 'error', errorMessage)
      return context.redirect('/', 302)
    }
  })

  async function handleShortUrlRedirect(
    context: Context,
    shortUrl: string,
    providedSecretKey: string | null,
  ): Promise<Response> {
    const link = await linksRepository.findByShortUrl(shortUrl, true)
    if (link === null) {
      if (config.redirectMissingLinksToIndex && config.indexRedirectUrl.length > 0) {
        return context.redirect(config.indexRedirectUrl, 302)
      }
      const pageContext = await buildPageRenderContext(context, config, usersRepository)
      return context.html(renderNotFoundPage(pageContext), 404)
    }

    if (link.isDisabled) {
      if (config.redirectMissingLinksToIndex && config.indexRedirectUrl.length > 0) {
        return context.redirect(config.indexRedirectUrl, 302)
      }
      const pageContext = await buildPageRenderContext(context, config, usersRepository)
      return context.html(
        renderErrorPage(
          pageContext,
          'Sorry, but this link has been disabled by an administrator.',
        ),
        200,
      )
    }

    if (link.secretKey !== null && link.secretKey.length > 0) {
      if (providedSecretKey === null || !constantTimeStringEqual(providedSecretKey, link.secretKey)) {
        return context.text('403 ', 403)
      }
    }

    try {
      await linksRepository.incrementClicks(link.id)
    }
    catch (error) {
      logError?.(error)
    }
    return context.redirect(link.longUrl, 301)
  }

  app.get('/:short_url', async (context) => {
    const shortUrl = context.req.param('short_url')
    return handleShortUrlRedirect(context, shortUrl, null)
  })

  app.get('/:short_url/:secret_key', async (context) => {
    const shortUrl = context.req.param('short_url')
    const secretKey = context.req.param('secret_key')
    return handleShortUrlRedirect(context, shortUrl, secretKey)
  })
}
