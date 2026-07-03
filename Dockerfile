FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY client client
COPY server server
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    SCRUBARR_HOST=0.0.0.0 \
    SCRUBARR_PORT=8098 \
    SCRUBARR_DATA_DIR=/data \
    SCRUBARR_LOG_DIR=/logs

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY server server
COPY --from=build /app/client/dist client/dist

RUN mkdir -p /data /logs && chown -R node:node /app /data /logs

USER node

EXPOSE 8098

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SCRUBARR_PORT || '8098') + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "-w", "server"]
