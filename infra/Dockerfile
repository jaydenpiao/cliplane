FROM node:24-alpine AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN apk add --no-cache python3 ffmpeg font-dejavu ca-certificates \
  && npm ci --cache /tmp/cliplane-npm-cache \
  && npm run build \
  && rm -rf /tmp/cliplane-npm-cache /app/apps/web/.next/cache \
  && mkdir -p /app/data \
  && chown node:node /app/data
ENV NODE_ENV=production API_PORT=4000 DATA_DIR=/app/data DEMO_ENABLED=0
USER node
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
