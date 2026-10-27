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
const compose = read('compose.yaml');
const installer = read('install.sh');
const main = read('backend/src/main.rs');
const nginxActive = nginx
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

must(/USER\s+10003:10003/.test(dockerfile), 'ingress runtime must use dedicated non-root UID/GID');
must(/EXPOSE\s+8444/.test(dockerfile), 'ingress runtime must expose only dedicated container port 8444');
must(!/openssl\s+ca-certificates/.test(dockerfile.split('FROM runtime-base AS runtime')[0]),
  'ingress runtime should not need the OpenSSL CLI');

must(/listen\s+8444\s+ssl\s*;/.test(nginxActive), 'dedicated TLS listener missing');
must(/ssl_protocols\s+TLSv1\.3\s*;/.test(nginxActive), 'TLS1.3-only contract missing');
must(/ssl_ecdh_curve\s+X25519MLKEM768\s*;/.test(nginxActive), 'mandatory hybrid group missing');
must(/ssl_session_tickets\s+off\s*;/.test(nginxActive), 'TLS tickets must stay disabled');
must(/ssl_session_cache\s+off\s*;/.test(nginxActive), 'TLS session cache must stay disabled');
must(/ssl_early_data\s+off\s*;/.test(nginxActive), 'TLS early data must stay disabled');
must(/return\s+404\s*;/.test(nginxActive), 'P0-C1 ingress must remain HTTP-inert');
must(!/\bproxy_pass\b|\bupstream\b/.test(nginxActive), 'P0-C1 ingress must have no backend/application hop');
must(!/\breturn\s+30[12378]\b/.test(nginxActive), 'P0-C1 ingress must not redirect to another path');
must(!/listen\s+443\b/.test(nginxActive), 'P0-C1 runtime must not replace public panel :443');

for (const source of [compose, installer]) {
  must(!source.includes('xsp-v2-ingress') && !source.includes('xsp-v2-node-ingress'),
    'default production setup must not activate the experimental ingress runtime');
}
must(!main.includes('"/api/v2/node/keys/rotation/ack"'),
  'ACK route must remain unmounted until the transport gate is complete');

console.log('XSP-v2 dedicated ingress runtime contract: OK (inert, PQ-only, not production-activated)');
