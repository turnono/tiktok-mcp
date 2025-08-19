FROM node:18-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-fund --no-audit

COPY . ./
RUN npm run build

# Runtime stage
FROM node:18-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY --from=base /app/build ./build

# Environment variables used by the MCP server
# ENV BACKEND_BASE_URL=
# ENV BACKEND_API_KEY=
# ENV ENABLE_SEARCH=false

CMD ["node", "build/index.js"]


