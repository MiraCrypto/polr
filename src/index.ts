import { serve } from '@hono/node-server'
import { createApplication } from './app.js'
import { loadApplicationConfiguration } from './config.js'
import { createPostgresClient } from './db/client.js'
import { createPostgresLinksRepository } from './db/linksRepository.js'
import { createPostgresUsersRepository } from './db/usersRepository.js'

const config = loadApplicationConfiguration()
const sql = createPostgresClient(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
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

async function handleGracefulShutdown(): Promise<void> {
  server.close()
  await sql.end({ timeout: 5 })
  process.exit(0)
}

process.on('SIGINT', () => {
  void handleGracefulShutdown()
})

process.on('SIGTERM', () => {
  void handleGracefulShutdown()
})
