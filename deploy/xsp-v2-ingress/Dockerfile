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

# The ACK/recovery gate has a substantially larger JSON + C2-C state machine,
# so it is built as an isolated Cargo crate with serde's strict typed decoder.
FROM rust:1.99-trixie AS origin-ack-builder
WORKDIR /src
COPY deploy/xsp-v2-ingress/origin-ack-rs/Cargo.toml /src/Cargo.toml
COPY deploy/xsp-v2-ingress/origin-ack-rs/src /src/src
RUN cargo test --release \
    && cargo build --release

# C2-B/C/D uses the same no-network UID/GID/OpenSSL boundary but executes only
# the compiled Rust ACK/recovery binary. No Python interpreter is present.
FROM origin-probe AS origin-ack-gate
COPY --from=origin-ack-builder /src/target/release/xsp-origin-ack-gate /usr/local/bin/xsp-origin-ack-gate
ENTRYPOINT ["/usr/local/bin/xsp-origin-ack-gate"]

# Test client only: OpenSSL and socat stay outside both ingress/origin runtime
# images. The tiny `nc -w SEC -U PATH` compatibility wrapper is test-only and
# translates the existing negative-peer harness to socat's Unix-connect mode.
FROM debian:trixie-slim AS probe
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates socat \
    && rm -rf /var/lib/apt/lists/* \
    && printf '%s\n' \
       '#!/bin/sh' \
       'set -eu' \
       '[ "$#" -eq 4 ] && [ "$1" = "-w" ] && [ "$3" = "-U" ]' \
       'exec socat -T"$2" - "UNIX-CONNECT:$4"' \
       > /usr/local/bin/nc \
    && chmod 0755 /usr/local/bin/nc
ENTRYPOINT ["/bin/sh"]
