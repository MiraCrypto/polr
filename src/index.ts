import { serve } from '@hono/node-server'
import { createApplication } from './app.js'
import { loadApplicationConfiguration } from './config.js'
import { createPostgresClient } from './db/client.js'
import { createPostgresLinksRepository } from './db/linksRepository.js'
import { createPostgresUsersRepository } from './db/usersRepository.js'

const POSTGRES_MAX_CONNECTIONS = 10
const POSTGRES_IDLE_TIMEOUT_SECONDS = 20
const POSTGRES_CONNECT_TIMEOUT_SECONDS = 10
const POSTGRES_DRAIN_TIMEOUT_SECONDS = 5
const FORCED_SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000

const config = loadApplicationConfiguration()
const sql = createPostgresClient(config.databaseUrl, {
  max: POSTGRES_MAX_CONNECTIONS,
  idle_timeout: POSTGRES_IDLE_TIMEOUT_SECONDS,
  connect_timeout: POSTGRES_CONNECT_TIMEOUT_SECONDS,
})
const usersRepository = createPostgresUsersRepository(sql)
const linksRepository = createPostgresLinksRepository(sql)

const app = createApplication({
  config,
  usersRepository,
  linksRepository,
})

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
})

let isShuttingDown = false

async function handleGracefulShutdown(): Promise<void> {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  const forcedExitTimer = setTimeout(() => {
    process.exit(1)
  }, FORCED_SHUTDOWN_TIMEOUT_MILLISECONDS)
  forcedExitTimer.unref()

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  await sql.end({ timeout: POSTGRES_DRAIN_TIMEOUT_SECONDS })
  process.exit(0)
}

process.on('SIGINT', () => {
  void handleGracefulShutdown()
})

process.on('SIGTERM', () => {
  void handleGracefulShutdown()
})
