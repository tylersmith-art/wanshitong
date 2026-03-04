FROM node:20-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/hooks/package.json packages/hooks/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
COPY packages/hooks/ packages/hooks/
COPY packages/web/ packages/web/

ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE

RUN pnpm --filter @template/shared build
RUN pnpm --filter @template/api build
RUN pnpm --filter @template/hooks build
RUN pnpm --filter @template/web build

FROM base AS production
WORKDIR /app
RUN npm install express@4
COPY --from=build /app/packages/web/dist ./dist
COPY --from=build /app/packages/web/web-server.js ./

EXPOSE 3000
CMD ["node", "web-server.js"]
