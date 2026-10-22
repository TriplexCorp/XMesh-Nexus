# syntax=docker/dockerfile:1.7
FROM rust:1.99.1-bookworm AS builder
WORKDIR /build/backend
ENV CARGO_INCREMENTAL=0
COPY backend/Cargo.toml ./Cargo.toml
COPY backend/src ./src
COPY backend/migrations ./migrations
# Keep dependency downloads and compiled artifacts between Docker builds.
# Mounting target as a cache requires copying the final binary outside it.
RUN --mount=type=cache,id=xmesh-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=xmesh-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=xmesh-cargo-target,target=/build/backend/target,sharing=locked \
    cargo build --release \
    && mkdir -p /build/output \
    && cp target/release/xmesh-api /build/output/xmesh-api

# Offline-at-runtime flag bundle, pinned at build time. No browser/CDN requests.
FROM node:24-bookworm-slim AS flag-assets
WORKDIR /flags
RUN npm pack flag-icons@7.5.0 --silent \
    && tar -xzf flag-icons-7.5.0.tgz \
    && test -s package/flags/4x3/kp.svg \
    && test -s package/flags/4x3/de.svg

FROM debian:bookworm-slim AS runtime
ENV APP_ADDR=0.0.0.0:8080 \
    STATIC_DIR=/app/static \
    CORE_DATA_DIR=/var/lib/xmesh/core \
    RUST_LOG=info,tower_http=info,sqlx=warn
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 xmesh \
    && useradd --system --uid 10001 --gid xmesh --home-dir /nonexistent --shell /usr/sbin/nologin xmesh \
    && mkdir -p /app/static /var/lib/xmesh/core \
    && chown -R xmesh:xmesh /app /var/lib/xmesh
COPY --from=builder /build/output/xmesh-api /usr/local/bin/xmesh-api
COPY --from=flag-assets /flags/package/flags/4x3/ /app/static/flags/
# MIT license for bundled flag-icons assets.
COPY --from=flag-assets /flags/package/LICENSE /app/static/flags/LICENSE
COPY index.html styles.css global-hover.css i18n.js subscription-studio.css subscription-studio.js subscription-portal.js qr-code.js mfa-ui.js security-ui.js xray-studio-v4.css xray-studio-dialogs.js xray-studio-tools.js xray-studio-v4.js xray-json-intelligence.js xray-json-diagnostics.js client-config.js app.js login.html login.css login.js /app/static/
RUN chown -R xmesh:xmesh /app/static
USER 10001:10001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/api/v1/health/ready >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/xmesh-api"]
