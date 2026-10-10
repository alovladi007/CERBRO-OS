# Cerebro OS — production image (zero npm dependencies, no build step).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WORKERS=auto \
    LOG=1

WORKDIR /app

# Only what the server needs at runtime.
COPY --chown=node:node package.json ./
COPY --chown=node:node server/ ./server/
COPY --chown=node:node web/ ./web/

# The official image ships an unprivileged "node" user (uid 1000).
USER node

EXPOSE 8080

# Alpine has no curl; use Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "server/server.mjs"]
