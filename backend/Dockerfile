# syntax=docker/dockerfile:1.7
FROM rust:1.99.1-bookworm AS builder
WORKDIR /build/backend
ENV CARGO_INCREMENTAL=0
ARG PANEL_BUILD_REVISION=unknown
ENV PANEL_BUILD_REVISION=${PANEL_BUILD_REVISION}
COPY VERSION /build/VERSION
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
    && test -s package/flags/4x3/de.svg \
    && test -s package/flags/4x3/gb.svg \
    && test -s package/flags/4x3/gy.svg \
    && test -s package/flags/4x3/xk.svg

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
    && mkdir -p /app/static /var/lib/xmesh/core /run/xmesh-signer \
    && chown -R xmesh:xmesh /app /var/lib/xmesh \
    && chown 10002:10001 /run/xmesh-signer \
    && chmod 0750 /run/xmesh-signer
COPY --from=builder /build/output/xmesh-api /usr/local/bin/xmesh-api
COPY --from=flag-assets /flags/package/flags/4x3/ /app/static/flags/
# MIT license for bundled flag-icons assets.
COPY --from=flag-assets /flags/package/LICENSE /app/static/flags/LICENSE
# Browser source remains organized under frontend/. The public subscription
# router intentionally supports arbitrary 2..9-segment paths, so nested static
# URLs would be captured by those routes before ServeDir's fallback. Keep the
# organized tree for auditability, but create unique flat runtime aliases and
# rewrite only the packaged entrypoints to those collision-free URLs.
COPY frontend/ /app/static/
RUN set -eux; \
    find /app/static -type f \( -name '*.css' -o -name '*.js' \) -print | \
    while IFS= read -r src; do \
      name="$(basename "$src")"; \
      target="/app/static/$name"; \
      [ "$src" = "$target" ] && continue; \
      if [ -e "$target" ]; then \
        echo "duplicate browser asset basename: $name" >&2; \
        exit 1; \
      fi; \
      cp "$src" "$target"; \
      rel="${src#/app/static}"; \
      sed -i "s|$rel|/$name|g" /app/static/index.html /app/static/login.html; \
    done; \
    # CSS entrypoints are flattened too. Rewrite authored relative imports to
    # the already-created flat aliases or production silently loses design
    # tokens/features while the entrypoint itself still returns HTTP 200.
    sed -E -i \
      -e 's|url\("\./([^"/]+\.css)(\?[^"/]*)?"\)|url("/\1\2")|g' \
      -e 's|url\("\.\./system/([^"/]+\.css)(\?[^"/]*)?"\)|url("/\1\2")|g' \
      -e 's|url\("\.\./features/[^"/]*/([^"/]+\.css)(\?[^"/]*)?"\)|url("/\1\2")|g' \
      /app/static/nexus-ui-v3.css /app/static/login.css
RUN chown -R xmesh:xmesh /app/static
USER 10001:10001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/api/v1/health/ready >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/xmesh-api"]
