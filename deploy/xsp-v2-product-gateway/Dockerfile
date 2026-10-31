FROM golang:1.27.3-trixie AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/xmesh-xsp-v2-product-gateway .

FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 xmesh-crypto \
 && useradd --uid 10004 --gid 10001 --no-create-home --shell /usr/sbin/nologin xmesh-product
COPY --from=build /out/xmesh-xsp-v2-product-gateway /usr/local/bin/xmesh-xsp-v2-product-gateway
USER 10004:10001
ENTRYPOINT ["/usr/local/bin/xmesh-xsp-v2-product-gateway"]
