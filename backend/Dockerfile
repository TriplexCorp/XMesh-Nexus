# syntax=docker/dockerfile:1.7
FROM rust:1.99.1-bookworm AS builder
WORKDIR /build/backend
COPY backend/Cargo.toml ./Cargo.toml
COPY backend/src ./src
COPY backend/migrations ./migrations
RUN cargo build --release

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
COPY --from=builder /build/backend/target/release/xmesh-api /usr/local/bin/xmesh-api
COPY index.html styles.css global-hover.css xray-studio.css app.js xray-studio-v5.js xray-studio-dialog.js login.html login.css login.js /app/static/
RUN chown -R xmesh:xmesh /app/static
USER 10001:10001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/api/v1/health/ready >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/xmesh-api"]
