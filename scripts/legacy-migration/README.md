# Legacy Polr 2.x Migration (MySQL / MariaDB to PostgreSQL)

Standalone one-time utilities for migrating `users` and `links` from a legacy Polr 2.x MySQL or MariaDB database into PostgreSQL. These scripts are intentionally isolated from `src/` and production builds.

## 1. Export Legacy MySQL / MariaDB Tables

Run [`export-mysql.ts`](export-mysql.ts) on a host with the `mysql` (or `mariadb`) CLI client installed:

```bash
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=polr \
MYSQL_PWD='your-mysql-password' \
MYSQL_DATABASE=polr \
node scripts/legacy-migration/export-mysql.ts legacy-dump.json
```

Optional environment variables:
- `MYSQL_SOCKET`: Path to a local MySQL/MariaDB Unix socket.
- `MYSQL_BIN`: Client binary name when `mysql` is not installed (e.g. `MYSQL_BIN=mariadb`).

## 2. Import into PostgreSQL

Run [`import-postgres.ts`](import-postgres.ts) against an empty PostgreSQL database (or one already initialized with [`src/db/schema.sql`](../../src/db/schema.sql)):

```bash
DATABASE_URL='postgres://polr:password@127.0.0.1:5432/polr' \
node scripts/legacy-migration/import-postgres.ts legacy-dump.json
```

Everything executes inside a single PostgreSQL transaction:
- Initializes [`src/db/schema.sql`](../../src/db/schema.sql) automatically if `users` does not exist yet, and refuses to overwrite non-empty tables.
- Preserves legacy `$2y$` / `$2a$` bcrypt password hashes, API keys, secret link keys, and click counts.
- Resolves `links.creator` usernames to `users(id)` foreign keys, repairs `0000-00-00 00:00:00` MySQL timestamps, and skips blank usernames or custom endings that collide with reserved application routes.
- Advances `users.id`, `links.id`, and `link_counter_seq` past the highest imported values.
