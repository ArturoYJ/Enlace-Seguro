FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install only Chromium and its OS libraries. The browser sandbox stays enabled;
# runtime must be non-root and the host must allow the required user namespaces.
COPY package.json package-lock.json ./
COPY src ./src
RUN npm ci --include=dev && \
    npx playwright install --with-deps --only-shell chromium

COPY tsconfig.json ./tsconfig.json

RUN npm run build && \
    npm prune --omit=dev && \
    useradd --system --create-home --uid 10001 --shell /usr/sbin/nologin enlaceseguro && \
    mkdir -p /app/captures && \
    chown -R enlaceseguro:enlaceseguro /app && \
    chmod -R a+rX /ms-playwright

USER enlaceseguro:enlaceseguro
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
