# Landed web (Next.js 16, standalone output). Convex stays hosted: the image needs the public URLs of a
# Convex deployment at build time (they are inlined into the client bundle) and nothing secret.
#   docker build --build-arg NEXT_PUBLIC_CONVEX_URL=https://<dep>.convex.cloud \
#                --build-arg NEXT_PUBLIC_CONVEX_SITE_URL=https://<dep>.convex.site -t landed-web web
#   docker run -p 3000:3000 landed-web
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CONVEX_SITE_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# convex/_generated is committed, so no deployment access is needed to build.
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/signin >/dev/null || exit 1
CMD ["node", "server.js"]
