#!/usr/bin/env node
'use strict';

const {panelStyles}=require('./ci/frontend-source.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');

const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const sec=fs.readFileSync('frontend/js/auth/security-ui.js','utf8');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-metrics-agent.sh','utf8');
const css=panelStyles();

new Function(app);
new Function(sec);

const matches=(source,pattern,message)=>assert.match(source,pattern,message);
const rejects=(source,pattern,message)=>assert.doesNotMatch(source,pattern,message);

// Statistics entrypoint and data sources.
matches(app,/\['statistics','chart-no-axes-combined','Статистика'/);
matches(app,/statistics:\['Статистика',statisticsP\]/);
matches(app,/function statisticsP\(\)/);
matches(app,/\/api\/v1\/statistics\/overview/);
matches(app,/\/api\/v1\/metrics\/traffic\?range=/);
matches(app,/\/api\/v1\/statistics\/period-leaders/);
matches(app,/traffic\/history\?/);
matches(app,/traffic\/observations/);
matches(app,/metrics\/traffic\/bucket-detail/);
matches(app,/CPU steal/);
matches(app,/stats-quality/);
matches(app,/id="stats-leaders"/);
matches(app,/id="stats-history-results"/);
matches(app,/id="stats-live-badge"/);
matches(app,/id="stats-sample-age"/);

// User intelligence is a native top-layer dialog. Shared dialog components own
// backdrop and viewport safety; Statistics only owns its internal geometry.
matches(app,/<dialog id="stats-user-modal" class="stats-user-overlay" data-dialog-size="workspace"/);
matches(app,/if\(!modal\.open\)modal\.showModal\(\)/);
matches(app,/\$\('#stats-user-modal'\)\.close\(\)/);
rejects(app,/statsPortal|document\.body\.append\(statsPortal\)/,'Statistics dialog must stay in the browser top layer');
rejects(app,/const sourceRect=dlg\.getBoundingClientRect\(\)/,'Statistics navigation must not measure source dialog geometry');
rejects(app,/dialogSize:\{width:sourceRect\.width,height:sourceRect\.height\}/,'Return navigation must not persist measured dialog geometry');
rejects(app,/--stats-source-width/,'Statistics must not export measured geometry through CSS variables');
matches(app,/userTrafficReturn=\{hash:location\.hash\|\|'#users',userId:id\}/);
matches(css,/dialog:not\(\[open\]\)\s*\{\s*display:none/,'Shared dialog system must preserve native open\/closed semantics');
matches(css,/dialog::backdrop\s*\{[\s\S]*?background:var\(--xm-modal-dim\)[\s\S]*?backdrop-filter:blur\(var\(--xm-modal-blur\)\)/,'Shared dialog system must own backdrop tokens');
matches(css,/dialog:is\([^}]*\[data-dialog-size=workspace\][^}]*\)\s*\{\s*--dialog-width:132rem/,'Workspace dialogs must use the shared viewport-safe sizing contract');
rejects(css,/\.stats-user-overlay\[hidden\]/,'Native dialog visibility must not depend on a legacy overlay [hidden] rule');

// Statistics user workspace and tabs keep feature-owned, content-driven layout.
matches(app,/class="stats-user-workspace"/);
matches(app,/data-stats-user-tab="history"/);
matches(app,/data-stats-user-tab="inbounds"/);
matches(app,/data-stats-user-tab="observations"/);
matches(app,/const showStatsUserTab=name=>/);
matches(app,/\$\$\('\.stats-user-pane'\)\.forEach/);
assert.equal((app.match(/\$\$\('\.stats-user-tabs button'\)\.forEach/g)||[]).length,2);
rejects(app,/(?<!\$)\$\([^\n;]*\)\.forEach\s*\(/,'querySelector returns one element; iterable paths must use $$');
matches(css,/\.stats-user-workspace\s*\{[\s\S]*?display:grid[\s\S]*?grid-template-columns:/);
matches(css,/\.stats-user-tabs\s*\{[\s\S]*?display:flex[\s\S]*?flex-direction:row/);
matches(css,/\.stats-user-actions\s*\{[\s\S]*?margin-left:auto[\s\S]*?display:flex[\s\S]*?flex-direction:row/);
matches(css,/\.stats-user-pane:not\(\[hidden\]\)\s*\{/);
matches(css,/@media \(max-width:999px\)[\s\S]*?\.stats-user-workspace\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)/);
matches(css,/@media \(min-width:\s*1000px\) and \(min-height:\s*650px\)[\s\S]*?\.stats-user-workspace\s*\{[\s\S]*?grid-template-columns:/);
matches(css,/\.stats-user-dialog\s*\{[\s\S]*?display:flex[\s\S]*?flex-direction:column/);

// User actions stay compact and do not require specificity escalation.
matches(app,/id="stats-user-refresh" class="gh stats-user-refresh"/);
matches(app,/id="stats-user-close" class="gh stats-user-close"/);
matches(app,/refreshButton\.classList\.add\('is-refreshing'\)/);
matches(app,/finally\{if\(request===historyRequest&&refreshButton\)/);
matches(css,/@keyframes stats-user-refresh-spin/);
matches(css,/\.stats-user-actions #stats-user-refresh \.stats-refresh-icon\s*\{[\s\S]*?display:block/);
matches(css,/\.stats-user-actions #stats-user-close\s*\{[\s\S]*?flex:0 0 2\.15rem/);

// Detailed traffic chart and bucket drill-down.
matches(app,/const statsDetailedChart=\(points,chartWidth=1000\)=>/);
matches(app,/statsDetailedChart\(points\)/);
matches(app,/data-bucket-ms/);
matches(app,/const openBucket=async\(bucketMs\)=>/);
assert.equal((app.match(/\$\$\('\.stats-detail-point-wrap'\)\.forEach/g)||[]).length,2,
  'selected SVG points must use querySelectorAll for both open and close');
rejects(app,/(?<!\$)\$\('\.stats-detail-point-wrap'\)\.forEach/,
  'querySelector yields one element and has no forEach');
matches(app,/id="stats-bucket-detail" class="stats-bucket-detail" hidden/);
matches(app,/panel\.hidden=false/);
matches(app,/\$\('#stats-bucket-detail'\)\.hidden=true/);
matches(css,/\.stats-bucket-detail\s*\{[\s\S]*?display:grid/);
matches(app,/class="stats-detail-point-hit"/);
matches(app,/e\.target\.closest\?\.\('\.stats-detail-point-wrap'\)/);
matches(css,/\.stats-detail-point-hit\s*\{[\s\S]*?fill:transparent[\s\S]*?stroke:none[\s\S]*?pointer-events:all/);
matches(css,/\.stats-detail-point-wrap:is\(:hover,:focus-visible,\.is-selected\) \.stats-detail-point-ring/);
matches(css,/\.stats-detail-point-ring\s*\{/);
matches(css,/\.stats-detail-point-core\s*\{/);
rejects(css,/\.stats-detail-point-wrap[^\n{]*\{[^}]*drop-shadow/);
matches(css,/\.stats-detail-grid\s*\{/);
matches(css,/\.stats-detail-line\.rx\s*\{/);
matches(css,/\.stats-detail-line\.tx\s*\{/);
matches(css,/\.stats-detail-chart\s*\{[\s\S]*?height:21\.25rem/);

// Xray history and filters.
matches(app,/const statsXrayHistoryChart=points=>/);
matches(app,/statsXrayHistoryChart\(points\)/);
matches(app,/Подтверждённые дельты Upload и Download/);
matches(css,/\.stats-xray-line\s*\{/);
matches(app,/id="stats-history-user"/);
matches(app,/id="stats-history-inbound"/);
matches(app,/id="stats-history-node"/);
matches(app,/data-stats-history-user/);
matches(app,/Это не доказательство нулевого трафика/);
rejects(app,/id="stats-history-observations-load"/);
matches(app,/enhanceStatsPeriodSelect\(\$\('#stats-leaders-range'\)\)/);
matches(app,/enhanceStatsPeriodSelect\(\$\('#stats-history-range'\)\)/);
matches(app,/enhanceStatsPeriodSelect\(\$\('#stats-history-inbound'\)\)/);
matches(app,/enhanceStatsPeriodSelect\(\$\('#stats-history-node'\)\)/);
matches(app,/select\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
matches(css,/\.xm-period-menu\s*\{/);
matches(app,/const ownerDialog=select\.closest\('dialog'\)/,
  'Statistics period/select menus must discover their owning native dialog');
matches(app,/\(ownerDialog\|\|document\.body\)\.append\(menu\)/,
  'Statistics filter options must stay inside the non-inert modal dialog');
rejects(app,/^\s*document\.body\.append\(menu\);/m,
  'Body-portaled Statistics filter menus are inert inside native modals');
matches(app,/ownerDialog\?\.addEventListener\('close',close\)/,
  'Modal close must dismiss expanded filter menus');
matches(app,/menu\.style\.position=dialogRect\?'absolute':'fixed'/,
  'Native modal options use dialog-local positioning rather than viewport fixed positioning');
matches(app,/menu\.style\.left=\(left-\(dialogRect\?\.left\|\|0\)\)\/scaleX/,
  'Menu left position must be converted from viewport to dialog-local CSS pixels');
matches(app,/menu\.style\.top=\(top-\(dialogRect\?\.top\|\|0\)\)\/scaleY/,
  'Menu top position must be converted from viewport to dialog-local CSS pixels');
matches(css,/\.xm-period-portal\s*\{[\s\S]*?position:fixed[\s\S]*?z-index:var\(--nx-z-tooltip\)/,'Detached period menu must use the shared popover stacking token');
matches(css,/#stats-history-user::-webkit-inner-spin-button/);

// Live refresh and freshness semantics.
matches(app,/lastSampleAt=Number\.isFinite\(sampled\)/);
matches(app,/trafficSignature!==lastTrafficSignature\|\|period!==lastTrafficPeriod/);
matches(app,/updateLiveStatus\(\)/);
matches(css,/\.stats-live-badge\.is-paused\s*\{/);
matches(css,/@keyframes stats-live-pulse/);
matches(css,/@media \(prefers-reduced-motion:reduce\)/);
matches(app,/now-lastOverview>=15000/);
matches(app,/now-lastSystem>=15000/);
matches(app,/needOverview\?backendRequest\('\/api\/v1\/statistics\/overview'\)/);
matches(app,/needSystem\?api\.systemStats\(\)/);
matches(app,/const cadence=live\?5000:30000/);
matches(app,/if\(cur!=='statistics'\|\|document\.hidden\)return/);
matches(app,/if\(!refreshing&&Date\.now\(\)-lastRefresh>=cadence\)/);
matches(app,/void refresh\(true\)/);
matches(app,/telemetryState==='delayed'/);
matches(app,/userStatsStatus/);
matches(app,/rxReporting/);
matches(app,/<option value="live">В реальном времени<\/option>/);
matches(app,/<option value="5m">5 минут<\/option>/);
matches(app,/<option value="15m">15 минут<\/option>/);
matches(app,/<option value="30m">30 минут<\/option>/);
matches(app,/<option value="3h">3 часа<\/option>/);
matches(app,/<option value="6h">6 часов<\/option>/);
matches(app,/<option value="12h">12 часов<\/option>/);
matches(app,/<option value="7d">7 дней<\/option>/);
matches(app,/<option value="30d">30 дней<\/option>/);

// Statistics backend contracts and signed telemetry.
matches(backend,/async fn get_statistics_leaders/);
matches(backend,/async fn get_statistics_period_leaders/);
matches(backend,/async fn get_user_traffic_observations/);
matches(backend,/async fn get_user_traffic_history/);
matches(backend,/async fn get_traffic_bucket_detail\(/);
matches(backend,/async fn get_statistics_overview/);
matches(backend,/route\("\/statistics\/overview", get\(get_statistics_overview\)\)/);
matches(backend,/verified_traffic_deltas/);
matches(backend,/lifetime_since_first_verified_sample/);
matches(backend,/async fn persist_verified_traffic_deltas/);
matches(backend,/source_type='user'/);
matches(backend,/source_type='inbound'/);
matches(backend,/source_type=\$3/);
matches(backend,/LIMIT 501/);
matches(backend,/LIMIT 500/);
matches(backend,/viewer_read_only\(&actor\)/);
matches(backend,/fn metric_freshness\(/);
matches(backend,/mod metric_freshness_tests/);
matches(backend,/"live" => \("live", 5_i64\)/);
matches(backend,/"5m" => \("5m", 10_i64\)/);
matches(backend,/"7d" => \("7d", 3600_i64\)/);
matches(backend,/"30d" => \("30d", 21_600_i64\)/);
matches(backend,/SELECT cpu_percent, ram_used_bytes, ram_total_bytes/);
matches(backend,/cpu_steal_percent: Option<f64>/);
matches(backend,/cpuStealPercent/);
matches(agent,/cpu_steal/);
matches(agent,/cpu_steal >= last_cpu_steal/);
matches(agent,/cpu_steal_percent/);

// Presence requires fresh authenticated counter deltas and one handler per path.
matches(backend,/const USER_ONLINE_WINDOW_MS:\s*i64\s*=\s*45_000/);
matches(backend,/async fn get_user_presence\(/);
matches(backend,/userStatsAccepted/);
matches(backend,/latest_source_ms\.is_none_or/);
matches(backend,/sample\.uplink_bytes>previous\.last_uplink_bytes/);
matches(backend,/sample\.downlink_bytes>previous\.last_downlink_bytes/);
assert.equal((backend.match(/async fn ingest_node_metrics\(/g)||[]).length,1);
assert.equal((backend.match(/async fn get_user_presence\(/g)||[]).length,1);
assert.equal((backend.match(/async fn get_user_traffic\(/g)||[]).length,1);
assert.equal((agent.match(/# Distinct users with a verified Xray byte delta/g)||[]).length,1);
assert.equal((agent.match(/signed_file=/g)||[]).length,1);
matches(app,/\/api\/v1\/users\/presence/);
matches(app,/presenceFeedHealthy&&st\(u\)==='ACTIVE'/);

// Dashboard geometry remains responsive and feature-owned.
matches(css,/\.stats-dashboard\s*\{[\s\S]*?display:grid/);
matches(css,/#stats-dashboard \.stats-heading \.act\s*\{[\s\S]*?grid-template-columns:max-content minmax\(12rem,19rem\)/);
matches(css,/#stats-dashboard #stats-refresh\s*\{[\s\S]*?grid-column:1[\s\S]*?grid-row:1/);
matches(css,/#stats-dashboard #stats-period\s*\{[\s\S]*?grid-column:2[\s\S]*?grid-row:1/);
matches(css,/\.stats-node-grid\s*\{/);
matches(css,/@media \(max-width:700px\)[\s\S]*?\.stats-node-grid\s*\{[\s\S]*?grid-template-columns:1fr/);

// Node breakdown colors are stable and separate from upload\/download semantics.
matches(app,/function userServerColor\(id\)/);
matches(app,/registerUserNodeColors\(servers\)/);
matches(app,/userNodeDistance/);
matches(app,/const userNodeColors=new Map\(\)/);
matches(app,/--server-color:'\+userServerColor\(r\.nodeId\)/);
matches(app,/registerUserNodeColors\(servers\);const nodeTotal/);
matches(app,/class="stats-insight-node" style="--node-color:'\+userServerColor\(node\.nodeId\)/);
matches(app,/const nodeLegend=servers\.map/);
matches(css,/--traffic-upload:/);
matches(css,/--traffic-download:/);
matches(css,/\.stats-insight-track span\s*\{[\s\S]*?background:var\(--node-color,var\(--a\)\)/);

// Destructive reset must use the standard confirmation flow.
matches(app,/Сбросить трафик<\/button>/);
matches(app,/if\(a==='rst'\)\{/);
matches(app,/confirmBox\('Сбросить трафик пользователя/);
matches(app,/await api\.update\('users',id,\{used:0\}\)/);
rejects(app,/a=='rst'\?\{used:0\}/);

// Security feedback regressions covered by this cross-feature contract.
matches(sec,/announce\('Настройки безопасности успешно сохранены\.'/);
matches(sec,/announce\(error\.textContent,'error'\)/);
matches(sec,/if\(location\.pathname!==patch\.dashboardPath\)/);
matches(app,/toast-state-icon/);

// Scrollable panes use the shared scrollbar contract rather than feature-local hacks.
rejects(css,/--scrollbar-size:9px/,'Statistics must not pin a legacy global scrollbar size token');
matches(css,/scrollbar-color:var\(--scrollbar-thumb\) var\(--scrollbar-track\)/);
matches(css,/\.stats-user-pane \.stats-bucket-table-wrap\s*\{[\s\S]*?max-height:none[\s\S]*?overflow-y:visible[\s\S]*?overflow-x:auto/);

console.log('Statistics native-dialog, telemetry, responsive layout and feedback contracts: PASS');
