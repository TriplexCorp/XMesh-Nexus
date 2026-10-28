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
const origin = read('deploy/xsp-v2-ingress/origin_ack_gate.py');
const compose = read('compose.yaml');
const installer = read('install.sh');
const main = read('backend/src/main.rs');
const active = nginx
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

must(/FROM\s+runtime-base\s+AS\s+runtime-c2b/.test(dockerfile),
  'dedicated C2-B ingress image target missing');
must(/COPY\s+deploy\/xsp-v2-ingress\/nginx-c2b\.conf\s+\/etc\/nginx\/nginx\.conf/.test(dockerfile),
  'C2-B runtime must use its dedicated config');
must(/FROM\s+origin-probe\s+AS\s+origin-ack-gate/.test(dockerfile),
  'dedicated C2-B origin ACK target missing');
must(/origin_ack_gate\.py\s+\/usr\/local\/bin\/xsp-origin-ack-gate/.test(dockerfile),
  'C2-B origin target must install only the staging ACK gate');

must(/listen\s+8444\s+ssl\s*;/.test(active), 'C2-B dedicated TLS listener missing');
must(/ssl_protocols\s+TLSv1\.3\s*;/.test(active), 'C2-B must remain TLS1.3-only');
must(/ssl_ecdh_curve\s+X25519MLKEM768\s*;/.test(active), 'C2-B hybrid group missing');
must(/ssl_session_tickets\s+off\s*;/.test(active), 'TLS tickets must stay disabled');
must(/ssl_session_cache\s+off\s*;/.test(active), 'TLS session cache must stay disabled');
must(/ssl_early_data\s+off\s*;/.test(active), 'TLS early data must stay disabled');
must(/ssl_client_certificate\s+\/run\/xmesh-ingress-certs\/client-ca\.pem\s*;/.test(active),
  'C2-B client trust anchor missing');
must(/ssl_verify_client\s+optional\s*;/.test(active),
  'diagnostic handshake compatibility must remain explicit');
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
  'ACK locations must require verified client certificate');
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
must(origin.includes('ACK_PATH = "/api/v2/node/keys/rotation/ack"'),
  'origin must bind the exact ACK path');
must(origin.includes('RECOVERY_PATH = ACK_PATH + "/recovery"'),
  'origin must bind a distinct exact historical recovery path');
must(origin.includes('message["kind"] != "ack"'), 'origin must bind the ACK message class');
must(origin.includes('message["nodeId"] != node_id'), 'origin must bind body Node ID to trusted transport Node ID');
must(origin.includes('message["issuerId"] != f"node-{node_id}"'), 'origin must bind Node sender identity');
must(origin.includes('message["method"] != "POST"') && origin.includes('message["path"] != ACK_PATH'),
  'origin must keep signed ACK metadata bound to the original state-changing ACK path');
must(origin.includes('now_ms <= message["expiresAtMs"]'),
  'historical recovery must require the original ACK freshness window to be closed');
must(origin.includes('C2C_RECOVERY_REQUEST_MAGIC = b"XSP2C2H1"'),
  'historical recovery must use a distinct protected C2-C request domain');
must(origin.includes('"authorizationStatus": "not-verified"'),
  'C2-B structural-only mode must explicitly state that cryptographic authorization has not occurred');
must(!origin.includes('X-XSP-V2-Trusted-Node-ID'),
  'origin must never trust a forwarded caller Node ID header');

for (const source of [compose, installer]) {
  must(!source.includes('xsp-v2-ingress') && !source.includes('xsp-v2-node-ingress'),
    'default production setup must not activate the experimental ingress runtime');
}
must(!main.includes('"/api/v2/node/keys/rotation/ack"'),
  'default/experimental Rust API must not mount the ACK route during C2-B/D2 staging proof');

console.log('XSP-v2 C2-B/D2 contract: OK (two exact gated ACK operations over proven mTLS -> UDS boundary; no broad proxy)');
