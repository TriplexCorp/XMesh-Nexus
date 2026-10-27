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

# Disposable C2-A origin verifier. It shares numeric GID 10003 with ingress so
# the ingress can connect to the UDS, but runs under a different UID and checks
# SO_PEERCRED before trusting forwarded certificate evidence.
FROM debian:trixie-slim AS origin-probe
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10003 xmesh-origin-shared \
    && useradd --system --uid 10004 --gid xmesh-origin-shared --home-dir /nonexistent --shell /usr/sbin/nologin xmesh-origin
COPY deploy/xsp-v2-ingress/origin_probe.py /usr/local/bin/xsp-origin-probe
USER 10004:10003
WORKDIR /nonexistent
ENTRYPOINT ["python3", "/usr/local/bin/xsp-origin-probe"]

# Test client only: OpenSSL CLI is deliberately absent from the ingress runtime.
FROM debian:trixie-slim AS probe
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/sh"]
