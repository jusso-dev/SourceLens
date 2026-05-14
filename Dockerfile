# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat openssl \
  && corepack enable \
  && corepack prepare pnpm@10.11.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm fetch --frozen-lockfile
RUN pnpm install --frozen-lockfile --offline

FROM base AS build
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV REDIS_URL=redis://localhost:6379
ENV BETTER_AUTH_SECRET=build-only-secret-change-me-please-32chars
ENV BETTER_AUTH_URL=http://localhost:3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm db:generate
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p storage sample-uploads

EXPOSE 3000
CMD ["node", "server.js"]
