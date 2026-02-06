## ─── Stage 1: Build ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Enable corepack for Yarn 4
RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy dependency manifests first (cache layer)
COPY package.json yarn.lock .yarnrc.yml ./

# Install all dependencies (including dev for build)
RUN yarn install --immutable

# Copy source code
COPY . .

# Build Medusa (compiles TS + admin dashboard)
RUN yarn build


## ─── Stage 2: Production ─────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy built output and all dependencies
COPY --from=builder /app/.medusa ./.medusa
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/yarn.lock ./yarn.lock
COPY --from=builder /app/.yarnrc.yml ./.yarnrc.yml
COPY --from=builder /app/medusa-config.ts ./medusa-config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src

# Railway sets PORT dynamically
ENV PORT=9000
EXPOSE ${PORT}

# Run migrations then start server
CMD ["sh", "-c", "yarn medusa db:migrate && yarn medusa start --host 0.0.0.0 --port $PORT"]
