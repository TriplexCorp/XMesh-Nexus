#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {assertPackaged}=require('./ci/frontend-source.cjs');
const read=path=>fs.readFileSync(path,'utf8');
const html=read('frontend/index.html');
const script=read('frontend/js/features/settings/panel-version-topbar.js');
const css=read('frontend/styles/features/settings/panel-version-topbar.css');
const entry=read('frontend/styles/system/nexus-ui-v3.css');
const app=read('frontend/js/core/app.js');
const backend=read('backend/src/main.rs');
const version=read('backend/src/panel_version.rs');
const docker=read('backend/Dockerfile');
const signer=read('backend/Dockerfile.xsp-signer');
const compose=read('compose.yaml');
const ctl=read('xmeshctl');
const resolver=read('scripts/resolve-panel-build-revision.sh');
const install=read('install.sh');
const i18n=read('frontend/js/core/i18n.js');
new Function(script);
assertPackaged(assert,['panel-version-topbar.js','panel-version-topbar.css']);
assert.match(html,/id="top-panel-version"/);
assert.match(html,/data-panel-version-trigger[^>]*aria-expanded="false"/);
assert.match(html,/data-panel-version-menu[^>]*role="dialog"/);
assert.match(html,/data-panel-version-status[^>]*aria-live="polite"/);
assert.match(html,/panel-version-topbar[.]js[?]v=[a-f0-9]{12}/);
assert.match(entry,/panel-version-topbar[.]css[?]v=[a-f0-9]{12}/);
assert.match(app,/XMeshPanelVersion\?\.init\(sessionUser\)/);
assert.match(script,/getJSON\('\/api\/v1\/panel\/version'\)/);
assert.match(script,/getJSON\('\/api\/v1\/panel\/version\/check'\)/);
assert.match(script,/owner=user\?\.role==='owner'/);
assert.match(script,/addEventListener\('xmesh:locale-changed',render\)/,'Language changes must use the explicit locale event');
assert.doesNotMatch(script,/MutationObserver/,'Watching the lang attribute would recursively render the translator');
assert.match(script,/check\.hidden=!owner/);
assert.match(script,/settings\.hidden=!owner\|\|checked\?\.status!=='update_available'/);
assert.match(script,/status\.dataset\.state=checked\?\.status\|\|'idle'/);
assert.doesNotMatch(script,/method\s*:\s*['"]POST['"]/,'Checking updates must remain read-only');
assert.doesNotMatch(script,/\/api\/v1\/panel\/update/,'Version control must not queue an update');
assert.match(css,/\.top-panel-version-menu\[hidden\]/);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(backend,/\.route\("\/panel\/version", get\(panel_version::installed\)\)/);
assert.match(backend,/\.route\("\/panel\/version\/check", get\(panel_version::check\)\)/);
assert.match(version,/include_str!\("\.\.\/\.\.\/VERSION"\)/);
assert.match(version,/require_owner\(&actor\)\?/);
assert.match(version,/compare\/\{local\}\.\.\.\{remote_sha\}/);
assert.match(version,/"ahead" => "update_available"/);
assert.match(version,/"diverged"\), "unverifiable"/);
assert.match(version,/connect_timeout\(Duration::from_secs\(4\)\)/);
assert.match(docker,/COPY VERSION \/build\/VERSION/);
assert.match(signer,/source=VERSION,target=\/source\/VERSION,ro/,'Signer must bind the canonical product version');
assert.match(signer,/cp \/source\/VERSION \/build\/VERSION/,'Signer must make product version available before Rust compilation');
assert.match(docker,/ARG PANEL_BUILD_REVISION=unknown/);
assert.match(docker,/--mount=type=bind,source=\.,target=\/source,readonly/,
 'Direct Compose builds must inspect the checkout without copying Git into the image');
assert.match(docker,/sh \/source\/scripts\/resolve-panel-build-revision[.]sh/);
assert.match(docker,/sh \/source\/scripts\/resolve-panel-build-revision[.]sh[^\n]* > \/build\/PANEL_BUILD_REVISION/);
assert.match(docker,/PANEL_BUILD_REVISION="\$\(cat \/build\/PANEL_BUILD_REVISION\)" cargo build --release/,
 'Resolved SHA must be supplied to rustc instead of the unknown default');
assert.match(resolver,/status --porcelain --untracked-files=normal/,
 'Build revision must not impersonate a clean upstream commit for dirty sources');
assert.match(resolver,/diff --quiet HEAD/,
 'Build revision must reject locally changed tracked sources');
assert.match(compose,/PANEL_BUILD_REVISION: \$\{PANEL_BUILD_REVISION:-unknown\}/);
assert.match(ctl,/PANEL_BUILD_REVISION="\$revision" docker compose/);
assert.match(ctl,/resolve-panel-build-revision[.]sh/);
assert.match(install,/export PANEL_BUILD_REVISION=/);
assert.match(install,/resolve-panel-build-revision[.]sh/);
assert.match(i18n,/"Проверить обновления":"Check for updates"/);
assert.match(i18n,/"Не удалось связаться с GitHub\. Актуальность не подтверждена\."/);
assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'Balanced CSS');
// Exercise the resolver with actual Git history and a temporary worktree. The
// local metadata must be exact, not inferred from the remote branch tip.
const source=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-version-source-'));
const archive=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-version-archive-'));
const run=(revision,dir)=>execFileSync('sh',[path.resolve('scripts/resolve-panel-build-revision.sh'),revision,dir],{encoding:'utf8'}).trim();
const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
try{
  assert.equal(run('unknown',archive),'unknown','Archive without .git cannot claim SHA');
  git('init','-q');
  fs.writeFileSync(path.join(source,'fixture.txt'),'original\n');
  git('add','fixture.txt');
  git('-c','user.name=CI','-c','user.email=ci@example.invalid','commit','-qm','fixture');
  const revision=git('rev-parse','HEAD');
  assert.match(revision,/^[0-9a-f]{40}$/);
  assert.equal(run('unknown',source),revision,'Clean checkout discovers exact HEAD');
  assert.equal(run('main',source),'unknown','Invalid explicit revision is never substituted with HEAD');
  fs.appendFileSync(path.join(source,'fixture.txt'),'modified\n');
  assert.equal(run('unknown',source),'unknown','Tracked modifications must not impersonate HEAD');
  fs.writeFileSync(path.join(source,'fixture.txt'),'original\n');
  fs.writeFileSync(path.join(source,'extra.txt'),'untracked\n');
  assert.equal(run('unknown',source),'unknown','Untracked source files must invalidate HEAD');
  assert.equal(run(revision,source),revision,'Caller-supplied SHA is accepted as explicit build provenance');
  fs.rmSync(path.join(source,'extra.txt'));
  assert.equal(run('unknown',source),revision,'Clean checkout can recover after dirty changes');
}finally{
  fs.rmSync(source,{recursive:true,force:true});
  fs.rmSync(archive,{recursive:true,force:true});
}
console.log('Panel build provenance and owner-only on-demand update check: OK');
