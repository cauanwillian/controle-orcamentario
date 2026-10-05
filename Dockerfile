FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @orcamento/api build && pnpm --filter @orcamento/web build && pnpm --filter @orcamento/worker build

FROM build AS api
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]

FROM build AS web
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@orcamento/web", "start"]

FROM build AS worker
ENV NODE_ENV=production
ENTRYPOINT ["pnpm", "--filter", "@orcamento/worker"]
