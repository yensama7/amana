# Amana Gateway — single multi-stage Dockerfile for the whole system.
#
# Stage graph:
#   circuits ─┬─> api  (gateway + mock registry, gets the verification keys)
#             └─> web  (Next.js wallet/dashboard/loan, gets the .wasm/.zkey)
#
# docker-compose picks a stage per service via `target:`. BuildKit builds
# the shared `circuits` stage once, so the (deterministic-ish) trusted
# setup runs a single time and both services see MATCHING keys — critical:
# a proof made with one zkey will not verify against keys from another run.

# ---------------------------------------------------------------------------
# Stage 1: compile circuits + run the dev trusted setup.
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS circuits

# circom is a single static Rust binary — grab the pinned release.
ADD https://github.com/iden3/circom/releases/download/v2.1.9/circom-linux-amd64 /usr/local/bin/circom
RUN chmod +x /usr/local/bin/circom

RUN npm install -g snarkjs@0.7.4

WORKDIR /build
COPY circuits/package*.json circuits/
RUN cd circuits && npm install --no-audit --no-fund

COPY circuits circuits
COPY scripts scripts
RUN bash scripts/build-circuits.sh
# outputs now at /build/web/public/zk (wasm+zkey) and /build/api/zk (vkeys)

# ---------------------------------------------------------------------------
# Stage 2: the gateway API (Express + snarkjs verifier + mock registry).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS api

WORKDIR /app
COPY api/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY api/src ./src
COPY --from=circuits /build/api/zk ./zk

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/index.js"]

# ---------------------------------------------------------------------------
# Stage 3: the Next.js frontend (wallet, dashboard, mock loan app).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS web

WORKDIR /app
COPY web/package*.json ./
RUN npm install --no-audit --no-fund

COPY web .
# Precomputed proving artifacts, served statically from /zk/* for instant
# in-browser proving (no key generation at page load).
COPY --from=circuits /build/web/public/zk ./public/zk

# Baked into the build: Next's /api/* rewrite proxies to the gateway
# service on the compose network.
ENV API_URL=http://api:4000
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
