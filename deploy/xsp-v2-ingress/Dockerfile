# syntax=docker/dockerfile:1.7
# Disposable/reviewable XSP-v2 Node ingress runtime.
# It is not referenced by the default Compose stack or installer.
FROM debian:trixie-slim AS runtime-base
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 xmesh-ingress \
    && useradd --system --uid 10003 --gid xmesh-ingress --home-dir /nonexistent --shell /usr/sbin/nologin xmesh-ingress
COPY deploy/xsp-v2-ingress/nginx.conf /etc/nginx/nginx.conf
USER 10003:10003
WORKDIR /nonexistent
EXPOSE 8444
ENTRYPOINT ["nginx", "-g", "daemon off;"]

FROM runtime-base AS runtime

# C2-B is a separate opt-in image target so the proven C2-A runtime remains
# unchanged. Neither target is referenced by default Compose or install.sh.
FROM runtime-base AS runtime-c2b
COPY deploy/xsp-v2-ingress/nginx-c2b.conf /etc/nginx/nginx.conf

# The C2-A origin verifier is a dependency-free Linux Rust binary. Keep the
# fixed toolchain in the disposable build stage; the runtime contains no Rust
# toolchain and no Python interpreter.
FROM rust:1.99-trixie AS origin-probe-builder
WORKDIR /src
COPY deploy/xsp-v2-ingress/origin_probe.rs /src/origin_probe.rs
RUN rustc --edition=2024 --test /src/origin_probe.rs -o /tmp/origin-probe-tests \
    && /tmp/origin-probe-tests \
    && rustc --edition=2024 -O -C strip=symbols /src/origin_probe.rs -o /tmp/xsp-origin-probe

# Disposable C2-A origin verifier. It shares numeric GID 10003 with ingress so
# the ingress can connect to the UDS, but runs under a different UID and checks
# SO_PEERCRED before trusting forwarded certificate evidence.
FROM debian:trixie-slim AS origin-probe
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 xmesh-origin-shared \
    && useradd --system --uid 10004 --gid xmesh-origin-shared --home-dir /nonexistent --shell /usr/sbin/nologin xmesh-origin
COPY --from=origin-probe-builder /tmp/xsp-origin-probe /usr/local/bin/xsp-origin-probe
USER 10004:10003
WORKDIR /nonexistent
ENTRYPOINT ["/usr/local/bin/xsp-origin-probe"]

# C2-B/D still uses the pre-existing Python ACK gate during this bounded first
# migration. It inherits the proven Rust C2-A peercred/SPKI runtime boundary,
# then adds Python only in this later opt-in image target. A subsequent PR will
# migrate this larger ACK/recovery state machine separately.
FROM origin-probe AS origin-ack-gate
USER 0:0
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/xsp-v2-ingress/origin_ack_gate.py /usr/local/bin/xsp-origin-ack-gate
USER 10004:10003
ENTRYPOINT ["python3", "/usr/local/bin/xsp-origin-ack-gate"]

# Test client only: OpenSSL CLI is deliberately absent from the ingress runtime.
FROM debian:trixie-slim AS probe
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/sh"]
