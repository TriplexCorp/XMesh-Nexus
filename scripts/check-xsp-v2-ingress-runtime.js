#!/usr/bin/env node
'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function must(condition, message) {
  if (!condition) throw new Error(message);
}

const dockerfile = read('deploy/xsp-v2-ingress/Dockerfile');
const nginx = read('deploy/xsp-v2-ingress/nginx.conf');
const productNginx = read('deploy/xsp-v2-ingress/nginx-product.conf');
const originProbe = read('deploy/xsp-v2-ingress/origin_probe.rs');
const compose = read('compose.yaml');
const installer = read('install.sh');
const main = read('backend/src/main.rs');
const nginxActive = nginx
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');
const originStage = dockerfile.split('FROM debian:trixie-slim AS origin-probe')[1]
  ?.split('FROM origin-probe AS origin-ack-gate')[0] || '';

must(/USER\s+10003:10003/.test(dockerfile), 'ingress runtime must use dedicated non-root UID/GID');
must(/EXPOSE\s+8444/.test(dockerfile), 'ingress runtime must expose only dedicated container port 8444');
must(!/openssl\s+ca-certificates/.test(dockerfile.split('FROM runtime-base AS runtime')[0]),
  'ingress runtime should not need the OpenSSL CLI');
must(/FROM\s+rust:1\.99-trixie\s+AS\s+origin-probe-builder/.test(dockerfile),
  'C2-A origin probe must be compiled with the pinned Rust builder');
must(/FROM\s+debian:trixie-slim\s+AS\s+origin-probe/.test(dockerfile),
  'C2-A disposable origin-probe image target missing');
must(/COPY\s+--from=origin-probe-builder\s+\/tmp\/xsp-origin-probe\s+\/usr\/local\/bin\/xsp-origin-probe/.test(dockerfile),
  'C2-A runtime must copy only the compiled Rust origin binary');
must(/ENTRYPOINT\s+\["\/usr\/local\/bin\/xsp-origin-probe"\]/.test(originStage),
  'C2-A runtime must execute the compiled Rust origin binary directly');
must(!/\bpython3\b/.test(originStage) && !/origin_probe\.py/.test(originStage),
  'C2-A origin runtime must not contain or execute Python');
must(/USER\s+10004:10003/.test(dockerfile),
  'origin probe must use separate UID and shared ingress GID');

must(/listen\s+8444\s+ssl\s*;/.test(nginxActive), 'dedicated TLS listener missing');
must(/ssl_protocols\s+TLSv1\.3\s*;/.test(nginxActive), 'TLS1.3-only contract missing');
must(/ssl_ecdh_curve\s+X25519MLKEM768\s*;/.test(nginxActive), 'mandatory hybrid group missing');
must(/ssl_session_tickets\s+off\s*;/.test(nginxActive), 'TLS tickets must stay disabled');
must(/ssl_session_cache\s+off\s*;/.test(nginxActive), 'TLS session cache must stay disabled');
must(/ssl_early_data\s+off\s*;/.test(nginxActive), 'TLS early data must stay disabled');
must(/ssl_client_certificate\s+\/run\/xmesh-ingress-certs\/client-ca\.pem\s*;/.test(nginxActive),
  'client trust anchor missing');
must(/ssl_verify_client\s+optional\s*;/.test(nginxActive),
  'C1 diagnostic compatibility requires optional client request at TLS layer');
must(/location\s+=\s+\/__xsp_v2_identity_probe\s*\{/.test(nginxActive),
  'exact C2-A identity probe location missing');
must(/if\s*\(\$ssl_client_verify\s*!=\s*SUCCESS\)\s*\{\s*return\s+403\s*;/s.test(nginxActive),
  'identity probe must reject unverified client certificates');
must(/proxy_pass_request_headers\s+off\s*;/.test(nginxActive),
  'caller-controlled headers must not cross the origin boundary');
must(/proxy_pass_request_body\s+off\s*;/.test(nginxActive),
  'identity probe must not forward caller bodies');
must(/X-XSP-V2-Client-Verify\s+\$ssl_client_verify\s*;/.test(nginxActive),
  'origin must receive Nginx-generated client verification state');
must(/X-XSP-V2-Client-Cert\s+\$ssl_client_escaped_cert\s*;/.test(nginxActive),
  'origin must receive Nginx-generated client certificate evidence');
must(/proxy_pass\s+http:\/\/unix:\/run\/xmesh-origin\/xsp-v2-origin\.sock:\/identity-probe\s*;/.test(nginxActive),
  'C2-A origin hop must use the dedicated Unix socket');
must((nginxActive.match(/\bproxy_pass\b/g) || []).length === 1,
  'only the exact C2-A identity probe may proxy to an origin');
must(!/\bupstream\b/.test(nginxActive), 'C2-A must not introduce a generic upstream block');
must(!/proxy_pass\s+https?:\/\/(?!unix:)/.test(nginxActive),
  'C2-A must not proxy over TCP/IP');
must(/location\s+\/\s*\{\s*return\s+404\s*;/s.test(nginxActive),
  'all non-probe HTTP paths must remain inert 404');
must(!/\breturn\s+30[12378]\b/.test(nginxActive), 'ingress must not redirect to another path');
must(!/listen\s+443\b/.test(nginxActive), 'experimental runtime must not replace public panel :443');

must(originProbe.includes('SO_PEERCRED'), 'origin probe must authenticate Unix peer credentials');
must(originProbe.includes('XSP_EXPECTED_CLIENT_SPKI_SHA256'),
  'origin probe must pin the client SPKI rather than trust a caller Node ID');
must(originProbe.includes('XSP_EXPECTED_INGRESS_UID') && originProbe.includes('XSP_EXPECTED_INGRESS_GID'),
  'origin probe must pin ingress UID/GID');
must(originProbe.includes('Command::new("openssl")'),
  'Rust origin probe must preserve direct SPKI extraction through the reviewed OpenSSL boundary');
must(!originProbe.includes('X-XSP-V2-Trusted-Node-ID'),
  'origin probe must not trust a forwarded Node ID header');

// The historical C2-A experimental runtime must remain absent from the default
// production service table. The v6 product ingress is a different, explicit
// profile and is permitted only with its strict product configuration.
must(!/^\s{2}xsp-v2-(?:node-)?ingress:\s*$/m.test(compose),
  'default production setup must not activate the historical experimental ingress runtime');
must(/^\s{2}xsp-v2-product-ingress:\s*$/m.test(compose),
  'v6 product ingress service is missing');
must(/xsp-v2-product-ingress:[\s\S]*?profiles:\s*\["xsp-v2-product"\]/.test(compose),
  'v6 product ingress must remain behind the explicit product profile');
must(compose.includes('./deploy/xsp-v2-ingress/nginx-product.conf:/etc/nginx/nginx.conf:ro'),
  'v6 product ingress must mount the product-only Nginx route table');
must(installer.includes('docker compose --profile xsp-v2-product up'),
  'installer must explicitly start the mandatory v6 product profile after PQ provisioning');
must(/ssl_verify_client\s+on\s*;/.test(productNginx),
  'v6 product ingress must require a verified client certificate at TLS layer');
must(/ssl_ecdh_curve\s+X25519MLKEM768\s*;/.test(productNginx),
  'v6 product ingress must require the hybrid X25519MLKEM768 group');
must(!main.includes('"/api/v2/node/keys/rotation/ack"'),
  'ACK route must remain unmounted until C2-A origin identity is proven');

console.log('XSP-v2 ingress C2-A contract: OK; v6 product ingress is isolated behind its strict mandatory profile');
