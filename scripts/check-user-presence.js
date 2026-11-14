/* User presence must mean recent VERIFIED traffic, not a persistent flag. */
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-metrics-agent.sh','utf8');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const html=fs.readFileSync('frontend/index.html','utf8');

assert.match(backend,/const USER_ONLINE_WINDOW_MS: i64 = 45_000;/);
assert.match(backend,/now_ms - USER_ONLINE_WINDOW_MS/);
assert.match(app,/const USER_PRESENCE_WINDOW_MS=45_000;/);
assert.match(app,/data-user-presence-id/);
assert.match(backend,/\.route\("\/users\/presence", get\(get_user_presence\)\)/);
assert.match(backend,/\.route_layer\(\s*middleware::from_fn_with_state\(\s*state\.clone\(\)\s*,\s*auth::require_session\s*,?\s*\)\s*\)/,
 'Authenticated routes must retain the session middleware layer');
assert.match(app,/fetch\('\/api\/v1\/users\/presence'/);
assert.doesNotMatch(app.match(/const refreshPresence=async\(\)=>\{[\s\S]*?\n    \};/)?.[0]||'',/\/api\/v1\/bootstrap/);
assert.match(agent,/USER_STATS_AT_MS="\$snapshot_timestamp"/);
assert.match(agent,/now-last>45/);
assert.match(backend,/pg_advisory_xact_lock\(\$1\)/);
assert.match(backend,/telemetry_tx\.commit\(\)\.await\?/);
assert.match(backend,/metrics->>'userStatsAccepted'='true'/);
assert.match(backend,/sample\.uplink_bytes >= previous\.last_uplink_bytes/);
assert.match(backend,/sample\.downlink_bytes >= previous\.last_downlink_bytes/);
assert.match(backend,/LEAST\(\$3::BIGINT,\$4::BIGINT\)/);
// Keep the canonical core entrypoint content-addressed. Old root-level app.js aliases
// must never return as a compatibility shortcut.
assert.doesNotMatch(html,/<script\s+src=["']app\.js\?v=/,
 'legacy root app.js entrypoint must stay removed');
assert.match(html,/<script\s+src=["']\/js\/core\/app\.js\?v=[a-f0-9]{12}["']><\/script>/,
 'index.html must load the canonical content-addressed core app.js entry point');

// Behavioral model of the counters/source-time gate; protects the intended
// edge-case matrix alongside the signed Postgres integration test.
function active(prev,next,source,lastSource){
 return source>lastSource && !!prev &&
  next.up>=prev.up && next.down>=prev.down &&
  (next.up>prev.up || next.down>prev.down);
}
const a={up:100,down:50};
assert.equal(active(null,a,11,10),false,'first sample only establishes baseline');
assert.equal(active(a,{up:101,down:50},11,10),true,'uplink delta');
assert.equal(active(a,{up:100,down:51},11,10),true,'downlink delta');
assert.equal(active(a,a,11,10),false,'idle samples are not activity');
assert.equal(active(a,{up:90,down:51},11,10),false,'mixed counter reset');
assert.equal(active(a,{up:101,down:49},11,10),false,'mixed counter reset other direction');
assert.equal(active(a,{up:101,down:51},10,10),false,'duplicate sample');
assert.equal(active(a,{up:101,down:51},9,10),false,'out-of-order sample');
// A Telegram-created account without squads previously crashed both the
// node access statistics and the user search/table; disabling it masked the bug.
const telegram=fs.readFileSync('backend/src/telegram_admin_bot_commands.rs','utf8');
assert.match(telegram,/record\.insert\("squads"\.into\(\), json!\(\[squad_id\]\)\);/,
 'Telegram account creation must persist the confirmed squad');
assert.match(telegram,/let selected\s*=\s*sqlx::query_scalar/,'Selected squad must be validated');
assert.match(telegram,/FOR SHARE/,'Squad must be locked during creation');
assert.match(telegram,/selected_squad\.ok_or\("squad_not_selected"\)/,
 'Missing squad must block account creation');
assert.match(telegram,/AND squad_id IS NULL AND consumed_at IS NULL AND expires_at>NOW\(\)/,
 'Squad selection must be single-use and unexpired');
const telegramWorker=fs.readFileSync('backend/src/telegram_admin_bot_worker.rs','utf8');
assert.match(telegram,/strip_prefix\("v:cs:"\)/,'Picker callback must be handled');
assert.match(telegram,/strip_prefix\("v:cp:"\)/,'Picker pagination must be handled');
assert.match(telegramWorker,/action,amount,username,squad_id FROM telegram_admin_bot_actions/,
 'Confirmation must retrieve the selected squad');
const squadMigration=fs.readFileSync('backend/migrations/0121_telegram_admin_bot_create_squad.sql','utf8');
assert.match(squadMigration,/ADD COLUMN squad_id BIGINT/,'Squad choice must be persisted');
assert.match(telegram,/record\.insert\("devices"\.into\(\), json!\(\[\]\)\);/,
 'Telegram account creation must persist an empty device list');
assert.match(app,/const userSquads=u=>Array\.isArray\(u\?\.squads\)\?u\.squads:\[\];/,
 'Legacy accounts without squads must not crash UI rendering');
assert.match(app,/const uin=u=>\[\.\.\.new Set\(DB\.squads\.filter\(s=>userSquads\(u\)\.includes\(s\.id\)\)/,
 'Node statistics must handle accounts without squads');
assert.match(app,/const uf=u=>[\s\S]*?userSquads\(u\)\.map\(/,
 'User search must handle accounts without squads');
assert.match(app,/data-l="Доступ">\$\{userSquads\(u\)\.map\(/,
 'User list must display users even without squads');
assert.match(app,/c==='users'&&k==='created'\?x\.id:x\[k\]/,
 'Default user sort must show newly created accounts, even without createdAt');
assert.match(app,/DB\.users=normalizeUserList\(payload\.items\)/,
 'User list should refresh from the authoritative database');
assert.match(app,/DB\[key\]=Array\.isArray\(collections\[key\]\)\?\(key==='users'\?normalizeUserList\(collections\[key\]\)/,
 'Bootstrap must normalize legacy users before any rendering');
assert.match(app,/setInterval\(\(\)=>\{if\(cur==='users'&&!document\.hidden\)void refreshPanelUsers\(\)/,
 'Visible user page should notice new accounts created through integrations');
console.log('User presence guard and 45-second activity window: PASS');
