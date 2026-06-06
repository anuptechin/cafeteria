# ---- D'Decor Cafeteria API (Express + tsx) ----
# Build context is the repo root (workspaces), see docker-compose.yml.
FROM node:22-alpine

WORKDIR /app

# Workspace manifests first for layer caching.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json

# Install only the server workspace (includes tsx, its runtime).
RUN npm install -w server

# Server source.
COPY server ./server

# Entrypoint: wait for DB, apply schema, seed if empty, start.
COPY server/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4000

ENTRYPOINT ["sh", "/usr/local/bin/entrypoint.sh"]
