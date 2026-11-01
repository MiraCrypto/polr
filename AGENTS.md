# Agent and Developer Instructions

Parity checks and workflow invariants matching `.github/workflows/ci.yml`.

## Verification Commands

Execute checks in sequence prior to opening or updating pull requests:

| Step | Command | Description | Configuration |
| :--- | :--- | :--- | :--- |
| **Lint** | `pnpm lint` | Enforce code style and ESLint rules | `eslint.config.js` |
| **Typecheck** | `pnpm typecheck` | Validate static types (`noEmit`) across `src`, `tests`, and `scripts` | `tsconfig.json` |
| **Build** | `pnpm build` | Compile production assets (`src/**/*.ts`) into `dist/` | `tsconfig.build.json` |
| **Test** | `pnpm test` | Run unit and integration test suite | (zero-config) |

Use `pnpm lint:fix` to resolve auto-fixable lint issues.

## Invariants

- **Execution Order:** `pnpm lint` -> `pnpm typecheck` -> `pnpm build` -> `pnpm test`.
- **Fail Fast:** Resolve typecheck errors before testing or build emission.
- **Lockfile Hygiene:** Maintain `pnpm-lock.yaml` parity whenever modifying dependencies.
