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
const nginx = read('deploy/xsp-v2-ingress/nginx-c2b.conf');
const origin = read('deploy/xsp-v2-ingress/origin-ack-rs/src/main.rs');
const originCargo = read('deploy/xsp-v2-ingress/origin-ack-rs/Cargo.toml');
const compose = read('compose.yaml');
const installer = read('install.sh');
const main = read('backend/src/main.rs');
const active = nginx
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');
const ackStage = dockerfile.split('FROM origin-probe AS origin-ack-gate')[1]
  ?.split('FROM debian:trixie-slim AS probe')[0] || '';

must(/FROM\s+runtime-base\s+AS\s+runtime-c2b/.test(dockerfile),
  'dedicated C2-B ingress image target missing');
must(/COPY\s+deploy\/xsp-v2-ingress\/nginx-c2b\.conf\s+\/etc\/nginx\/nginx\.conf/.test(dockerfile),
  'C2-B runtime must use its dedicated config');
must(/FROM\s+rust:1\.99-trixie\s+AS\s+origin-ack-builder/.test(dockerfile),
  'C2-B/D ACK gate must use the pinned Rust builder');
must(/cargo\s+test\s+--release/.test(dockerfile) && /cargo\s+build\s+--release/.test(dockerfile),
  'Rust ACK gate builder must execute its unit tests before release build');
must(/FROM\s+origin-probe\s+AS\s+origin-ack-gate/.test(dockerfile),
  'dedicated C2-B origin ACK target missing');
must(/COPY\s+--from=origin-ack-builder\s+\/src\/target\/release\/xsp-origin-ack-gate\s+\/usr\/local\/bin\/xsp-origin-ack-gate/.test(dockerfile),
  'C2-B/D runtime must copy only the compiled Rust ACK gate');
must(/ENTRYPOINT\s+\["\/usr\/local\/bin\/xsp-origin-ack-gate"\]/.test(ackStage),
  'C2-B/D runtime must execute the compiled Rust ACK gate directly');
must(!/\bpython3\b/.test(ackStage) && !/origin_ack_gate\.py/.test(ackStage),
  'C2-B/D origin runtime must not contain or execute Python');
must(/serde\s*=/.test(originCargo) && /serde_json\s*=/.test(originCargo),
  'Rust ACK gate must use a typed serde decoder rather than ad-hoc JSON parsing');

must(/listen\s+8444\s+ssl\s*;/.test(active), 'C2-B dedicated TLS listener missing');
must(/ssl_protocols\s+TLSv1\.3\s*;/.test(active), 'C2-B must remain TLS1.3-only');
must(/ssl_ecdh_curve\s+X25519MLKEM768\s*;/.test(active), 'C2-B hybrid group missing');
must(/ssl_session_tickets\s+off\s*;/.test(active), 'TLS tickets must stay disabled');
must(/ssl_session_cache\s+off\s*;/.test(active), 'TLS session cache must stay disabled');
must(/ssl_early_data\s+off\s*;/.test(active), 'TLS early data must stay disabled');
must(/ssl_client_certificate\s+\/run\/xmesh-ingress-certs\/client-ca\.pem\s*;/.test(active),
  'C2-B client trust anchor missing');
must(/ssl_verify_client\s+on\s*;/.test(active),
  'C2-B/D2 must reject unverified clients during the TLS handshake');
must(!/ssl_verify_client\s+optional\s*;/.test(active),
  'C2-B/D2 must not defer client-certificate rejection to HTTP routing');
must(/client_max_body_size\s+16k\s*;/.test(active), 'ACK ingress body bound missing');
must(/client_body_timeout\s+5s\s*;/.test(active), 'ACK ingress body timeout missing');

must(/location\s+=\s+\/api\/v2\/node\/keys\/rotation\/ack\s*\{/.test(active),
  'exact C2-B ACK location missing');
must(/location\s+=\s+\/api\/v2\/node\/keys\/rotation\/ack\/recover\s*\{/.test(active),
  'exact current-Node C2-D2 historical recovery location missing');
must(!/location\s+=\s+\/api\/v2\/node\/keys\/rotation\/ack\/recovery\s*\{/.test(active),
  'obsolete external C2-D2 /recovery location must not remain mounted');
must(/if\s*\(\$request_method\s*!=\s*POST\)\s*\{\s*return\s+405\s*;/s.test(active),
  'ACK locations must reject every non-POST method');
must(/if\s*\(\$ssl_client_verify\s*!=\s*SUCCESS\)\s*\{\s*return\s+403\s*;/s.test(active),
  'ACK locations must retain verified-client defense in depth');
must(/if\s*\(\$http_content_type\s*!=\s*"application\/json"\)\s*\{\s*return\s+415\s*;/s.test(active),
  'ACK locations must require exact application/json');
must(/if\s*\(\$http_transfer_encoding\s*!=\s*""\)\s*\{\s*return\s+400\s*;/s.test(active),
  'ACK locations must reject transfer-encoding ambiguity');
must(/if\s*\(\$http_content_length\s*=\s*""\)\s*\{\s*return\s+411\s*;/s.test(active),
  'ACK locations must require an explicit bounded Content-Length');
must((active.match(/proxy_pass_request_headers\s+off\s*;/g) || []).length === 3,
  'identity probe, ACK and historical recovery must strip caller-controlled headers');
must((active.match(/proxy_request_buffering\s+on\s*;/g) || []).length === 2,
  'both ACK operations must fully buffer the body before the UDS origin transition');
must(/X-XSP-V2-Client-Verify\s+\$ssl_client_verify\s*;/.test(active),
  'origin must receive generated client verification state');
must(/X-XSP-V2-Client-Cert\s+\$ssl_client_escaped_cert\s*;/.test(active),
  'origin must receive generated client certificate evidence');
must(/Content-Type\s+application\/json\s*;/.test(active),
  'origin content type must be generated after ingress validation');
must(/proxy_pass\s+http:\/\/unix:\/run\/xmesh-origin\/xsp-v2-origin\.sock:\/api\/v2\/node\/keys\/rotation\/ack\s*;/.test(active),
  'C2-B ACK must cross only the protected Unix socket');
must(/proxy_pass\s+http:\/\/unix:\/run\/xmesh-origin\/xsp-v2-origin\.sock:\/api\/v2\/node\/keys\/rotation\/ack\/recovery\s*;/.test(active),
  'C2-D2 historical recovery must cross only the protected Unix socket');
must((active.match(/\bproxy_pass\b/g) || []).length === 3,
  'config may proxy only identity probe plus the two exact ACK operations');
must(!/\bupstream\b/.test(active), 'C2-B/D2 must not introduce a generic upstream block');
must(!/proxy_pass\s+https?:\/\/(?!unix:)/.test(active), 'C2-B/D2 must not proxy over TCP/IP');
must(/location\s+\/\s*\{\s*return\s+404\s*;/s.test(active),
  'all unrelated HTTP paths must remain inert 404');
must(!/\breturn\s+30[12378]\b/.test(active), 'C2-B/D2 must not redirect');
must(!/listen\s+443\b/.test(active), 'C2-B/D2 must not replace public panel :443');

must(origin.includes('SO_PEERCRED'), 'C2-B origin must authenticate Unix peer credentials');
must(origin.includes('XSP_EXPECTED_CLIENT_SPKI_SHA256'),
  'C2-B origin must pin the verified client SPKI');
must(origin.includes('XSP_EXPECTED_INGRESS_UID') && origin.includes('XSP_EXPECTED_INGRESS_GID'),
  'C2-B origin must pin ingress UID/GID');
must(origin.includes('XSP_V2_C2B_ACK_ROUTE') && origin.includes('staging-only'),
  'C2-B route must have an explicit staging-only runtime gate');
must(origin.includes('const ACK_PATH: &str = "/api/v2/node/keys/rotation/ack"'),
  'origin must bind the exact ACK path');
must(origin.includes('const RECOVERY_PATH: &str = "/api/v2/node/keys/rotation/ack/recovery"'),
  'origin must bind a distinct exact historical recovery path');
must((origin.match(/#\[serde\(deny_unknown_fields\)\]/g) || []).length >= 3,
  'top-level, message and signature JSON objects must reject unknown fields');
must(origin.includes('serde_json::from_slice(&raw)'),
  'ACK body must be decoded into the strict typed envelope');
must(origin.includes('message.kind != "ack"'), 'origin must bind the ACK message class');
must(origin.includes('message.node_id != trusted_node_id'),
  'origin must bind body Node ID to trusted transport Node ID');
must(origin.includes('message.issuer_id != expected_issuer'), 'origin must bind Node sender identity');
must(origin.includes('message.method != "POST"') && origin.includes('message.path != ACK_PATH'),
  'origin must keep signed ACK metadata bound to the original state-changing ACK path');
must(origin.includes('if now_ms <= message.expires_at_ms'),
  'historical recovery must require the original ACK freshness window to be closed');
must(origin.includes('C2C_RECOVERY_REQUEST_MAGIC') && origin.includes('b"XSP2C2H1"'),
  'historical recovery must use a distinct protected C2-C request domain');
must(origin.includes('C2C_UID: u32 = 10001') && origin.includes('C2C_GID: u32 = 10001'),
  'origin must authenticate the protected C2-C service peer');
must(origin.includes('authorize_c2c(config, node_id, &raw, recovery)'),
  'authorized C2-C transition must receive the exact raw ACK bytes');
must(origin.includes('"authorizationStatus":"not-verified"'),
  'C2-B structural-only mode must explicitly state that cryptographic authorization has not occurred');
must(origin.includes('DropBeforeC2c') && origin.includes('DropOnC2cFailure') && origin.includes('DropAfterC2cSuccess'),
  'disposable D2 response-loss fault domains must remain explicit and allowlisted');
must(origin.includes('const REQUEST_QUEUE_SIZE: i32 = 32') && origin.includes('listen(listener.as_raw_fd(), REQUEST_QUEUE_SIZE)'),
  'Rust ACK gate must preserve the reviewed fixed Unix listen backlog of 32');
must(!origin.includes('X-XSP-V2-Trusted-Node-ID'),
  'origin must never trust a forwarded caller Node ID header');

for (const source of [compose, installer]) {
  must(!source.includes('xsp-v2-ingress') && !source.includes('xsp-v2-node-ingress'),
    'default production setup must not activate the experimental ingress runtime');
}
must(!main.includes('"/api/v2/node/keys/rotation/ack"'),
  'default/experimental Rust API must not mount the ACK route during C2-B/D2 staging proof');

console.log('XSP-v2 C2-B/D2 contract: OK (Rust ACK/recovery gate over handshake-enforced mTLS -> UDS boundary; no Python runtime, no broad proxy)');
