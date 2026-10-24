# syntax=docker/dockerfile:1

# Imagen de Node 24: trae `node:sqlite`, así que la base no necesita
# compilación nativa y la imagen final queda sin toolchain de C.
FROM node:24-alpine AS build

WORKDIR /app

# Primero solo los manifiestos: así el `npm ci` se cachea mientras no cambien
# las dependencias, aunque cambie el código.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client

RUN npm run build

# Se descartan las dependencias de desarrollo para la imagen final.
RUN npm prune --omit=dev


FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_FILE=/data/puker.db

# Nunca correr como root.
RUN mkdir -p /data && chown -R node:node /data

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/shared/package.json ./shared/package.json
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/client/dist ./client/dist

USER node
EXPOSE 3001
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
