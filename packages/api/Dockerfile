FROM node:20-alpine AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
RUN pnpm --filter @wanshitong/shared build
RUN pnpm --filter @wanshitong/api build
RUN mkdir -p packages/api/drizzle

FROM base AS production
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist/
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/api/dist packages/api/dist/
COPY --from=build /app/packages/api/drizzle packages/api/drizzle/
RUN pnpm install --frozen-lockfile --prod

WORKDIR /app/packages/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
