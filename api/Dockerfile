# Imagen de producción de la API. Compila TypeScript en una etapa y copia solo lo necesario a la final.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
RUN useradd --system --create-home --uid 10002 --shell /usr/sbin/nologin enlaceseguro
COPY --from=build --chown=enlaceseguro:enlaceseguro /app/node_modules ./node_modules
COPY --from=build --chown=enlaceseguro:enlaceseguro /app/dist ./dist
COPY --chown=enlaceseguro:enlaceseguro package.json ./
USER enlaceseguro:enlaceseguro
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
