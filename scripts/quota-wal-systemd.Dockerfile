FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive container=docker
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl openssl gnupg git python3 certbot systemd systemd-sysv dbus \
    iproute2 iptables docker.io docker-compose-v2 && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /etc/docker && printf '{"storage-driver":"vfs"}\n' > /etc/docker/daemon.json && \
    systemctl enable docker.service
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
