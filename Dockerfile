# syntax=docker/dockerfile:1
# The app's image for an own server with Dokploy (docs/guia-despliegue.md, «Servidor propio con Dokploy»). One image,
# three uses (docker-compose.yml): `migrate` brings the database up to date, `web` is the app and `worker` runs the
# background work in a loop. It is built and tested by GitHub Actions (.github/workflows/imagen.yml), never on the
# server. It carries no keys: each installation gives its own through the environment when it starts.

# Node 24 LTS, exact version (docs/security.md: at least 7 days old).
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# pnpm, at the version of package.json («packageManager»), through Corepack, which comes with Node 24.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The rules of pnpm-workspace.yaml apply here too: 7 days of margin and only the approved install scripts.
RUN pnpm install --frozen-lockfile
COPY . .
# `next build` checks that an encryption key is configured, and the sign-in asks for its secret and address: throwaway
# ones, only for the build, never kept in the image. Each installation brings its own when it starts.
RUN APP_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")" \
    BETTER_AUTH_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")" \
    BETTER_AUTH_URL=http://localhost:3000 \
    pnpm build \
  && rm -rf .next/cache

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# The whole app with its dependencies: `migrate` and `worker` run the scripts of scripts/ with tsx, as `pnpm db:migrate`
# and `pnpm worker` do. Owned by the unprivileged user of the Node image.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# The web server; docker-compose.yml gives `migrate` and `worker` their own command.
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
