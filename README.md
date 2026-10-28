# Polr

Minimalist URL shortening platform powered by Node.js 26, TypeScript, Hono, and PostgreSQL.

## Requirements

- **Node.js** `>= 26.0.0`
- **PostgreSQL** `>= 16` (tested with PostgreSQL 18)
- **pnpm**

## Configuration

All runtime settings are loaded strictly from environment variables via [`src/config.ts`](src/config.ts). The server fails fast at startup if any required variable is missing or invalid.

Copy [`.env.example`](.env.example) to `.env` (or provide the variables via your process supervisor / container runtime):

| Variable | Type | Description |
| :--- | :--- | :--- |
| `PORT` | Positive integer | HTTP listen port (e.g. `3000`) |
| `HOST` | String | Bind address (e.g. `127.0.0.1` or `0.0.0.0`) |
| `APP_NAME` | String | Application display name |
| `APP_PROTOCOL` | String | Public URL scheme prefix (`https://` or `http://`) |
| `APP_ADDRESS` | String | Public domain/host (e.g. `short.example.com`) |
| `APP_KEY` | String | Secret key used for HMAC-SHA256 session and flash cookies |
| `DATABASE_URL` | String | PostgreSQL connection string |
| `POLR_BASE` | `32` \| `62` | Counter encoding base (`32` for `0-9a-v`, `62` for `0-9a-zA-Z`) |
| `POLR_SECRET_BYTES` | Positive integer | Random byte length for secret link keys (`2` produces 4 hex chars) |
| `_API_KEY_LENGTH` | Positive integer | Random byte length for generated user API keys (`15` produces 30 hex chars) |
| `SETTING_PUBLIC_INTERFACE` | Boolean (`true`/`false`/`1`/`0`) | Whether unauthenticated visitors can view the home page |
| `SETTING_SHORTEN_PERMISSION` | Boolean (`true`/`false`/`1`/`0`) | Whether shortening URLs via the web UI requires authentication |
| `SETTING_INDEX_REDIRECT` | String (optional) | External URL to redirect unauthenticated `/` requests when `SETTING_PUBLIC_INTERFACE=false` (falls back to `/login` when empty) |
| `SETTING_REDIRECT_404` | Boolean (`true`/`false`/`1`/`0`) | Redirect missing short links to `SETTING_INDEX_REDIRECT` instead of rendering a 404 page |
| `POLR_VERSION` | String | Version displayed on `/about-polr` |
| `POLR_RELDATE` | String | Release date displayed on `/about-polr` |
| `POLR_GENERATED_AT` | String | Instance provisioning date displayed to administrators on `/about-polr` |

## Database Setup

Apply [`src/db/schema.sql`](src/db/schema.sql) to your PostgreSQL database:

```bash
psql "$DATABASE_URL" -f src/db/schema.sql
```

## Development & Verification

```bash
pnpm install
pnpm run lint
pnpm run test
pnpm run build
pnpm run start
```

## License

GNU GPL v2+
