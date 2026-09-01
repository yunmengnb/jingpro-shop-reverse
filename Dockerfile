FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium HOME=/tmp XDG_CONFIG_HOME=/tmp/.config XDG_CACHE_HOME=/tmp/.cache
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
