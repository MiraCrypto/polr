import type { ApplicationConfiguration } from './config.js'
import type { LinksRepository, UsersRepository } from './db/repositories.js'
import type { PageRenderContext } from './views/pages.js'
import { fileURLToPath } from 'node:url'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { registerAjaxRoutes } from './routes/ajaxRoutes.js'
import { registerApiRoutes } from './routes/apiRoutes.js'
import { buildPageRenderContext } from './routes/requestContext.js'
import { registerWebRoutes } from './routes/webRoutes.js'
import { renderNotFoundPage, renderServerErrorPage } from './views/pages.js'

const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../public', import.meta.url))

function defaultErrorLogger(error: unknown): void {
  console.error(error)
}

export interface ApplicationDependencies {
  readonly config: ApplicationConfiguration
  readonly usersRepository: UsersRepository
  readonly linksRepository: LinksRepository
  readonly staticRoot?: string
  readonly logError?: (error: unknown) => void
}

export function createApplication(dependencies: ApplicationDependencies): Hono {
  const app = new Hono()
  const staticRoot = dependencies.staticRoot ?? DEFAULT_STATIC_ROOT
  const logError = dependencies.logError ?? defaultErrorLogger

  app.use('/css/*', serveStatic({ root: staticRoot }))
  app.use('/js/*', serveStatic({ root: staticRoot }))
  app.use('/img/*', serveStatic({ root: staticRoot }))
  app.use('/fonts/*', serveStatic({ root: staticRoot }))
  app.use('/directives/*', serveStatic({ root: staticRoot }))
  app.use('/favicon.ico', serveStatic({ root: staticRoot }))
  app.get('/favicon.ico', context => context.body(null, 204))

  const resolvedDependencies: ApplicationDependencies = {
    ...dependencies,
    logError,
  }

  registerAjaxRoutes(app, resolvedDependencies)
  registerApiRoutes(app, resolvedDependencies)
  registerWebRoutes(app, resolvedDependencies)

  app.notFound(async (context) => {
    if (
      dependencies.config.redirectMissingLinksToIndex
      && dependencies.config.indexRedirectUrl.length > 0
    ) {
      return context.redirect(dependencies.config.indexRedirectUrl, 302)
    }
    const pageContext = await buildPageRenderContext(
      context,
      dependencies.config,
      dependencies.usersRepository,
    )
    return context.html(renderNotFoundPage(pageContext), 404)
  })

  app.onError(async (error, context) => {
    logError(error)
    let pageContext: PageRenderContext
    try {
      pageContext = await buildPageRenderContext(
        context,
        dependencies.config,
        dependencies.usersRepository,
      )
    }
    catch {
      pageContext = {
        config: dependencies.config,
        csrfToken: '',
        currentUser: null,
        flashMessages: [],
      }
    }
    return context.html(renderServerErrorPage(pageContext), 500)
  })

  return app
}
