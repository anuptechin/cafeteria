# ---- D'Decor Cafeteria Web (Vite build -> nginx) ----
# Build context is the repo root (workspaces), see docker-compose.yml.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
RUN npm install -w web

COPY web ./web
RUN npm -w web run build

# ---- serve ----
FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
