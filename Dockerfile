FROM --platform=$BUILDPLATFORM docker.io/library/node:26-alpine AS pnpm-base

ENV CI=true
RUN npm install --global pnpm@11

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM pnpm-base AS prod-deps

RUN --mount=type=cache,id=pnpm,target=/var/cache/pnpm,sharing=locked \
    pnpm install --store-dir=/var/cache/pnpm --prod --frozen-lockfile

FROM pnpm-base AS build

RUN --mount=type=cache,id=pnpm,target=/var/cache/pnpm,sharing=locked \
    pnpm install --store-dir=/var/cache/pnpm --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm exec tsc --project tsconfig.build.json

FROM gcr.io/distroless/nodejs26-debian13:nonroot AS distroless

WORKDIR /app
COPY package.json ./package.json
COPY src/db/schema.sql ./schema.sql
COPY public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ARG POLR_VERSION=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    POLR_VERSION=${POLR_VERSION}

EXPOSE 3000
CMD ["dist/index.js"]

FROM docker.io/library/node:26-trixie-slim AS debian-slim

RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
COPY package.json ./package.json
COPY src/db/schema.sql ./schema.sql
COPY public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ARG POLR_VERSION=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    POLR_VERSION=${POLR_VERSION}

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/index.js"]

FROM docker.io/library/node:26-alpine AS alpine

RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
COPY package.json ./package.json
COPY src/db/schema.sql ./schema.sql
COPY public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ARG POLR_VERSION=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    POLR_VERSION=${POLR_VERSION}

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["dist/index.js"]
