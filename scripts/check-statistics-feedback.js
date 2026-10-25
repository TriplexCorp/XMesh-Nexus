#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const sec=fs.readFileSync('security-ui.js','utf8');
const backend=fs.readFileSync('backend/src/main.rs','utf8');
const agent=fs.readFileSync('deploy/node-metrics-agent.sh','utf8');
const css=fs.readFileSync('styles.css','utf8');
new Function(app);new Function(sec);
assert.match(app,/\['statistics','chart-no-axes-combined','Статистика'/);
assert.match(app,/statistics:\['Статистика',statisticsP\]/);
assert.match(app,/function statisticsP\(\)/);
assert.match(app,/\/api\/v1\/statistics\/overview/);
assert.match(app,/\/api\/v1\/metrics\/traffic\?range=/);
assert.match(app,/CPU steal/);
assert.match(app,/stats-quality/);
assert.match(app,/\/api\/v1\/statistics\/leaders/);
assert.match(app,/id="stats-leaders"/);
assert.match(app,/id="stats-history-results"/);
assert.match(app,/id="stats-user-modal"/);
assert.match(app,/data-stats-user-tab="history"/);
assert.match(app,/data-stats-user-tab="inbounds"/);
assert.match(app,/data-stats-user-tab="observations"/);
assert.match(app,/const showStatsUserTab=name=>/);
assert.match(app,/\$\$\('\.stats-user-pane'\)\.forEach/);
assert.equal((app.match(/\$\$\('\.stats-user-tabs button'\)\.forEach/g)||[]).length,2);
assert.doesNotMatch(app,/(?<!\$)\$\([^\n;]*\)\.forEach\s*\(/, 'querySelector returns an element, not a collection; use $ for forEach');
assert.match(app,/const closeStatsUser=\(\)=>/);
assert.match(css,/\.stats-user-overlay\[hidden\]/);
assert.match(app,/class="stats-user-workspace"/);
assert.match(app,/id="stats-user-source-insight"/);
assert.match(app,/id="stats-user-node-insight"/);
assert.match(app,/id="stats-user-refresh"/);
assert.match(app,/stats-insight-donut/);
assert.match(css,/backdrop-filter:blur\(13px\)/);
assert.match(css,/\.stats-user-workspace\{display:grid/);
assert.match(css,/@media\(max-width:1050px\)/);
assert.match(css,/Statistics intelligence: viewport-first landscape layout/);
assert.match(css,/var\(--panel-content-max, 1920px\)/);
assert.match(css,/max-height:calc\(100dvh - 2rem\)/);
assert.match(css,/\.stats-user-main\{display:flex;flex-direction:column;min-height:0;overflow:hidden\}/);


assert.match(app,/const statsXrayHistoryChart=points=>/);
assert.match(app,/statsXrayHistoryChart\(points\)/);
assert.match(app,/Подтверждённые дельты Upload и Download/);
assert.match(css,/\.stats-xray-line/);

assert.match(app,/id="stats-history-user"/);
assert.match(app,/id="stats-history-inbound"/);
assert.match(app,/id="stats-history-node"/);
assert.match(app,/data-stats-history-user/);
assert.match(app,/traffic\/history\?/);
assert.match(app,/Это не доказательство нулевого трафика/);

assert.match(backend,/async fn get_statistics_leaders/);
assert.match(backend,/async fn get_statistics_period_leaders/);
assert.match(backend,/async fn get_user_traffic_observations/);
assert.match(backend,/source_type='user'/);
assert.match(backend,/source_type='inbound'/);
assert.match(backend,/LIMIT 501/);
assert.match(app,/id="stats-leaders-range"/);
assert.match(app,/statistics\/period-leaders/);
assert.match(app,/id="stats-history-observations-load"/);
assert.match(app,/traffic\/observations/);

assert.match(backend,/lifetime_since_first_verified_sample/);
assert.match(backend,/async fn persist_verified_traffic_deltas/);
assert.match(backend,/async fn get_user_traffic_history/);
assert.match(backend,/verified_traffic_deltas/);
assert.match(backend,/traffic\/history/);
assert.match(backend,/source_type=\$3/);

assert.match(backend,/viewer_read_only\(&actor\)/);

assert.match(app,/const statsDetailedChart=\(points\)=>/);
assert.match(app,/statsDetailedChart\(points\)/);
assert.match(app,/data-bucket-ms/);
assert.match(app,/metrics\/traffic\/bucket-detail/);
assert.match(app,/const openBucket=async\(bucketMs\)=>/);
assert.equal((app.match(/\$\$\('\.stats-detail-point-wrap'\)\.forEach/g)||[]).length,2,
  'selected SVG points must use querySelectorAll for both open and close');
assert.doesNotMatch(app,/(?<!\$)\$\('\.stats-detail-point-wrap'\)\.forEach/,
  'querySelector yields only one element and has no forEach');
assert.match(app,/stats-bucket-detail/);
assert.match(backend,/async fn get_traffic_bucket_detail\(/);
assert.match(backend,/LIMIT 500/);
assert.match(css,/\.stats-bucket-detail\[hidden\]/);
assert.match(app,/class="stats-detail-point-wrap /);
assert.match(app,/Пропуски не интерполируются/);
assert.match(css,/\.stats-detail-point-wrap:is/);
assert.match(css,/\.stats-detail-point-ring/);
assert.match(css,/\.stats-detail-point-core/);
assert.match(app,/class="stats-detail-point-hit"/);
assert.match(css,/\.stats-detail-point-hit\{fill:transparent;stroke:none;pointer-events:all/);
assert.match(app,/e\.target\.closest\?\.\('\.stats-detail-point-wrap'\)/);
assert.doesNotMatch(css,/\.stats-detail-point-wrap[^\n]*drop-shadow/);
assert.match(css,/\.stats-detail-grid/);
assert.match(css,/\.stats-detail-line\.rx/);
assert.match(css,/\.stats-detail-line\.tx/);
assert.match(app,/id="stats-live-badge"/);
assert.match(app,/id="stats-sample-age"/);
assert.match(app,/lastSampleAt=Number\.isFinite\(sampled\)/);
assert.match(app,/trafficSignature!==lastTrafficSignature\|\|period!==lastTrafficPeriod/);
assert.match(app,/updateLiveStatus\(\)/);
assert.match(css,/\.stats-live-badge\.is-paused/);
assert.match(css,/@keyframes stats-live-pulse/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(app,/now-lastOverview>=15000/);
assert.match(app,/now-lastSystem>=15000/);
assert.match(app,/needOverview\?backendRequest\('\/api\/v1\/statistics\/overview'\)/);
assert.match(app,/needSystem\?api\.systemStats\(\)/);
assert.match(app,/const cadence=live\?5000:30000/);
assert.match(app,/if\(cur!=='statistics'\|\|document\.hidden\)return/);
assert.match(app,/if\(!refreshing&&Date\.now\(\)-lastRefresh>=cadence\)/);
assert.match(app,/void refresh\(true\)/);
assert.match(app,/telemetryState==='delayed'/);
assert.match(app,/userStatsStatus/);
assert.match(app,/rxReporting/);
assert.match(app,/<option value="live">В реальном времени<\/option>/);
assert.match(app,/<option value="5m">5 минут<\/option>/);
assert.match(app,/<option value="15m">15 минут<\/option>/);
assert.match(app,/<option value="30m">30 минут<\/option>/);
assert.match(app,/<option value="3h">3 часа<\/option>/);
assert.match(app,/<option value="6h">6 часов<\/option>/);
assert.match(app,/<option value="12h">12 часов<\/option>/);
assert.match(app,/id="stats-refresh"[\s\S]*?id="stats-period"/);
assert.match(app,/'refresh-cw':'<path/);
assert.match(backend,/"live" => \("live", 5_i64\)/);
assert.match(backend,/"5m" => \("5m", 10_i64\)/);
assert.match(app,/<option value="7d">7 дней<\/option>/);
assert.match(app,/<option value="30d">30 дней<\/option>/);
assert.match(backend,/fn metric_freshness\(/);
assert.match(backend,/mod metric_freshness_tests/);
assert.match(backend,/"7d" => \("7d", 3600_i64\)/);
assert.match(backend,/"30d" => \("30d", 21_600_i64\)/);
assert.match(app,/quality==='stale'/);
assert.match(app,/statsValue\(ok\?v\.cpuStealPercent:null,'%'/);
assert.match(app,/Нет данных/);
assert.match(backend,/route\("\/statistics\/overview", get\(get_statistics_overview\)\)/);
assert.match(backend,/async fn get_statistics_overview/);
assert.match(backend,/SELECT cpu_percent, ram_used_bytes, ram_total_bytes/);
assert.match(backend,/cpu_steal_percent: Option<f64>/);
assert.match(backend,/cpuStealPercent/);
assert.match(agent,/cpu_steal/);
assert.match(agent,/cpu_steal >= last_cpu_steal/);
assert.match(agent,/cpu_steal_percent/);
assert.match(css,/\.stats-node-grid\{/);
assert.match(css,/#stats-dashboard \.stats-heading \.act\{/);
assert.match(css,/grid-template-columns:max-content minmax\(12rem,19rem\)/);
assert.match(css,/#stats-dashboard #stats-refresh\{grid-column:1;grid-row:1/);
assert.match(css,/#stats-dashboard #stats-period\{grid-column:2;grid-row:1/);
assert.match(sec,/announce\('Настройки безопасности успешно сохранены\.'/);
assert.match(sec,/announce\(error\.textContent,'error'\)/);
assert.match(app,/toast-state-icon/);
assert.match(sec,/if\(location\.pathname!==patch\.dashboardPath\)/);
// Presence requires fresh authenticated counter deltas; guard against duplicated handlers.
assert.match(backend,/const USER_ONLINE_WINDOW_MS:\s*i64\s*=\s*45_000/);
assert.match(backend,/async fn get_user_presence\(/);
assert.match(backend,/userStatsAccepted/);
assert.match(backend,/latest_source_ms\.is_none_or/);
assert.match(backend,/sample\.uplink_bytes>previous\.last_uplink_bytes/);
assert.match(backend,/sample\.downlink_bytes>previous\.last_downlink_bytes/);
assert.equal((backend.match(/async fn ingest_node_metrics\(/g)||[]).length,1);
assert.equal((backend.match(/async fn get_user_presence\(/g)||[]).length,1);
assert.equal((backend.match(/async fn get_user_traffic\(/g)||[]).length,1);
assert.equal((agent.match(/# Distinct users with a verified Xray byte delta/g)||[]).length,1);
assert.equal((agent.match(/signed_file=/g)||[]).length,1);
assert.match(app,/\/api\/v1\/users\/presence/);
assert.match(app,/presenceFeedHealthy&&st\(u\)==='ACTIVE'/);
console.log('Statistics view, real signed steal-time and save-confirmation contracts: PASS');

// Stats overlay must escape transformed/scoped workspace containers to blur the entire app.
assert.match(app,/document\.body\.append\(statsPortal\)/);
assert.match(app,/document\.querySelector\('body > #stats-user-modal'\)\?\.remove\(\)/);
assert.match(css,/body > \.stats-user-overlay\{position:fixed;inset:0;width:100vw;height:100dvh/);

assert.match(app,/id="stats-user-refresh" class="gh stats-user-refresh"/);
assert.match(app,/id="stats-user-close" class="gh stats-user-close"/);
assert.match(css,/\.stats-user-tabs\{display:flex;flex-direction:row/);
assert.match(css,/\.stats-user-actions\{margin-left:auto;display:flex;flex-direction:row/);

// Regression: a single DOM element cannot be iterated with for...of.
assert.match(app,/for\(const button of \$\$\('\.stats-user-actions button'\)\)/);
assert.doesNotMatch(app,/for\(const button of \$\('\.stats-user-actions button'\)\)/);

// Tab switching must not affect the outer modal dimensions.
assert.match(css,/Stable modal geometry independent from selected statistics tab/);
assert.match(css,/height:calc\(100dvh - 3rem\);max-height:calc\(100dvh - 3rem\)/);
assert.match(css,/\.stats-user-pane:not\(\[hidden\]\)\{/);

assert.doesNotMatch(app,/id="stats-history-load"/);
assert.match(app,/refreshButton\.classList\.add\('is-refreshing'\)/);
assert.match(app,/finally\{if\(request===historyRequest&&refreshButton\)/);
assert.match(css,/@keyframes stats-user-refresh-spin/);
assert.match(css,/\.stats-refresh-icon\{display:block!important/);

assert.match(css,/#stats-user-close\{flex:0 0 2\.15rem/);
