# Polr

Minimalist URL shortening platform powered by Node.js 26, TypeScript, Hono, and PostgreSQL.

## Requirements

- **Node.js** `>= 26.0.0`
- **PostgreSQL** `>= 16` (tested with PostgreSQL 18)
- **pnpm**

## Quick Start

1. Install dependencies and configure required environment variables (see [`.env.example`](.env.example)), generating a strong `APP_KEY` (`openssl rand -hex 32`):

```bash
pnpm install
cp .env.example .env
```

2. Apply [`src/db/schema.sql`](src/db/schema.sql) to PostgreSQL:

```bash
pnpm run db:setup
```

3. Bootstrap or reset administrator and standard user accounts:

```bash
ADMIN_PASSWORD='your-strong-password' pnpm run create-admin admin admin@example.com
USER_PASSWORD='your-user-password' pnpm run create-user member member@example.com
```

4. Build and start the server:

```bash
pnpm run build
pnpm run start
```

## Configuration

Runtime configuration is validated at startup in [`src/config.ts`](src/config.ts). Missing required variables or invalid values fail fast before binding the HTTP server.

### Required Variables

| Variable | Description |
| :--- | :--- |
| `APP_NAME` | Application display name |
| `APP_PROTOCOL` | Public URL scheme (`https://` or `http://`) |
| `APP_ADDRESS` | Public host (e.g. `short.example.com` or `localhost:3000`) |
| `APP_KEY` | Random secret key used for HMAC-SHA256 session and flash cookies |
| `DATABASE_URL` | PostgreSQL connection URI (supports TCP hosts and Unix domain sockets via `%2Frun%2Fpostgresql` or `?host=/run/postgresql`) |

### Optional Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP listen port (`1`–`65535`) |
| `HOST` | `127.0.0.1` | HTTP bind address (`0.0.0.0` in official container images) |
| `POLR_BASE` | `62` | Counter encoding base (`32` for `0-9a-v`, `62` for `0-9a-zA-Z`) |
| `POLR_SECRET_BYTES` | `2` | Random byte length for secret link keys (`2` produces 4 hex chars) |
| `_API_KEY_LENGTH` | `15` | Random byte length for user API keys (`15` produces 30 hex chars) |
| `SETTING_PUBLIC_INTERFACE` | `true` | Allow unauthenticated visitors to view `/` |
| `SETTING_SHORTEN_PERMISSION` | `false` | Require login to shorten URLs via the web UI |
| `SETTING_REDIRECT_404` | `false` | Redirect missing or disabled short links to `SETTING_INDEX_REDIRECT` |
| `SETTING_INDEX_REDIRECT` | `""` | External redirect target when `SETTING_PUBLIC_INTERFACE=false` or `SETTING_REDIRECT_404=true` |
| `POLR_GENERATED_AT` | Unset | Optional instance provisioning date shown to admins on `/about-polr` |

## Container Deployment

Multi-architecture (`linux/amd64`, `linux/arm64`) images are published to GitHub Container Registry (`ghcr.io/<owner>/polr`) in three variants:

| Variant | Tags | Base Image | Runtime User |
| :--- | :--- | :--- | :--- |
| **Alpine** (default) | `latest`, `alpine`, `<version>` | `node:26-alpine` | `node` (`1000`) |
| **Debian Slim** | `debian-slim`, `slim`, `<version>-debian-slim` | `node:26-trixie-slim` | `node` (`1000`) |
| **Distroless** | `distroless`, `nonroot`, `<version>-distroless` | `gcr.io/distroless/nodejs26-debian13:nonroot` | `nonroot` (`65532`) |

All variants invoke `node` directly as PID 1, default to `HOST=0.0.0.0` and `PORT=3000`, and bundle `/app/schema.sql` alongside `dist/createAdmin.js`:

```bash
# Bootstrap or reset an administrator account via container (works across all variants, including distroless)
docker run --rm --env-file .env -e ADMIN_PASSWORD='your-strong-password' \
  ghcr.io/<owner>/polr:latest dist/createAdmin.js admin admin@example.com

# Start the HTTP server (bind-mounting /run/postgresql if connecting over a host Unix socket)
docker run -d --name polr --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  ghcr.io/<owner>/polr:latest
```

To build a specific variant locally:

```bash
docker build --target alpine -t polr:alpine .
docker build --target debian-slim -t polr:debian-slim .
docker build --target distroless -t polr:distroless .
```

## Development & Verification

```bash
pnpm run dev
pnpm run lint
pnpm run test
pnpm run build
```

## Migrating from Polr 2.x

For upgrading an existing MySQL / MariaDB Polr 2.x database to PostgreSQL, see [`scripts/legacy-migration/README.md`](scripts/legacy-migration/README.md).

## License

GNU GPL v2+
