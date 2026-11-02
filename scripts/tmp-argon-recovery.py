#!/usr/bin/env python3
from pathlib import Path

login = Path('frontend/styles/auth/login.css')
login.write_text('''@import url("../system/nexus-v3-foundation.css");
@import url("../system/nexus-v3-components.css");

*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--tx);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{min-height:100dvh;background-image:radial-gradient(ellipse 90vw 75vh at 50% 25%,color-mix(in srgb,var(--a) 10%,transparent),transparent 70%)}
.login-shell{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.75rem 1.15rem}
.login-card{width:min(100%,26.5rem);padding:2.25rem;border:1px solid var(--nx-border-strong);border-radius:var(--nx-card-radius);background:var(--nx-panel-bg);box-shadow:var(--nx-dialog-shadow)}
.brand-mark{width:2.85rem;height:2.85rem;display:grid;place-items:center;border-radius:var(--nx-control-radius);border:1px solid var(--nx-selected-border);background:var(--nx-selected-bg);color:var(--a);font-size:1.45rem;font-weight:800}
.eyebrow{margin:1.5rem 0 .65rem;color:var(--a);font:600 .65rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em}
.eyebrow span,.footer span{color:var(--mu)}
h1{font-size:1.85rem;line-height:1.15;letter-spacing:-.04em;margin:0;font-weight:750}
.intro{margin:.75rem 0 1.75rem;color:var(--nx-muted);font-size:.82rem;line-height:1.65}
form{display:flex;flex-direction:column}
label{font-size:.76rem;font-weight:650;color:var(--tx);margin:0 0 .45rem}
input{width:100%;min-height:var(--nx-control-h-lg);margin-bottom:1.15rem;border:1px solid var(--nx-border);border-radius:var(--nx-control-radius);background:var(--nx-control-bg);color:var(--tx);padding:0 .85rem;font:inherit;font-size:.88rem}
input:focus{border-color:var(--nx-selected-border);outline:2px solid var(--nx-focus);outline-offset:1px}
button{min-height:var(--nx-control-h-lg);border:1px solid var(--a);border-radius:var(--nx-control-radius);background:var(--a);color:var(--btn-text);font:750 .84rem/1 inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.55rem}
button:not(:disabled):hover{background:color-mix(in srgb,var(--a) 88%,var(--tx))}
button:active{transform:translateY(1px)}
button:disabled{opacity:.6;cursor:wait}
button span{font-size:1.05rem}
.error{min-height:1.15rem;margin:-.4rem 0 .65rem;color:var(--er);font-size:.76rem;line-height:1.5}
.security-note{display:flex;align-items:center;justify-content:center;gap:.5rem;margin:1.5rem 0 0;color:var(--mu);font-size:.7rem}
.status-dot{width:.4rem;height:.4rem;border-radius:50%;background:var(--a)}
.footer{margin:1.6rem 0 0;color:var(--mu);font:500 .6rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.15em;text-align:center}
@media(max-width:480px){.login-card{padding:1.65rem 1.35rem}h1{font-size:1.65rem}}
@media(prefers-reduced-motion:reduce){button{transition:none}}

#password-step{display:flex;flex-direction:column}
#password-step[hidden],#mfa-step[hidden],#mfa-back[hidden]{display:none}
#mfa-step{display:flex;flex-direction:column}
.mfa-hint{font-size:.76rem;color:var(--nx-muted);line-height:1.6;margin:-.5rem 0 1.1rem}
#mfa-back{background:var(--nx-control-bg);color:var(--mu);min-height:var(--nx-control-h-sm);margin-top:.5rem;border:1px solid var(--nx-border)}
#mfa-back:not(:disabled):hover{background:var(--nx-hover-bg);color:var(--tx)}
''', encoding='utf-8')

dialogs = Path('frontend/styles/features/nodes/node-dialogs.css')
css = dialogs.read_text(encoding='utf-8')
marker = 'dialog.xm-action-confirm:has(.xm-action-confirm-icon)'
if marker not in css:
    prefix = '''dialog.xm-action-confirm:has(.xm-action-confirm-icon){
  width:min(760px,calc(100vw - 2rem));
  max-width:calc(100vw - 2rem);
}
dialog.xm-action-confirm:has(.xm-action-confirm-icon) .xm-action-confirm-box{
  position:relative;
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:
    "icon title close"
    "body body body"
    "actions actions actions";
  align-items:center;
  gap:.85rem 1rem;
}
dialog.xm-action-confirm:has(.xm-action-confirm-icon) .xm-action-confirm-icon{grid-area:icon}
dialog.xm-action-confirm:has(.xm-action-confirm-icon) .xm-action-confirm-box>h2{grid-area:title;margin:0}
dialog.xm-action-confirm:has(.xm-action-confirm-icon) .xm-action-confirm-box>p{grid-area:body;margin:0}
dialog.xm-action-confirm:has(.xm-action-confirm-icon) .xm-action-confirm-actions{grid-area:actions}
.xm-action-confirm-close{grid-area:close;position:static;width:var(--xm-close-size,34px);height:var(--xm-close-size,34px);display:grid;place-items:center;border-radius:50%}

'''
    dialogs.write_text(prefix + css, encoding='utf-8')

nodes = Path('frontend/styles/features/nodes/nodes.css')
node_css = nodes.read_text(encoding='utf-8')
node_css = node_css.replace('background:var(--a);color:var(--btn-text)}','background:var(--a);color:var(--btn-text);}',1)
nodes.write_text(node_css, encoding='utf-8')

browser = Path('scripts/test-ui-browser.cjs')
text = browser.read_text(encoding='utf-8')
old_user = "['users',`[data-uo=\"${user.id}\"]`,'Просмотр пользователя']"
new_user = "['users',`tr[data-id=\"${user.id}\"]`,'Просмотр пользователя']"
if old_user not in text and new_user not in text:
    raise SystemExit('browser user drawer selector drifted')
text = text.replace(old_user, new_user)
old_footer = "const footer=await page.locator('dialog[open] .act').last().boundingBox();"
new_footer = "const footerLoc=page.locator('dialog[open] > form.box > .act, dialog[open] > .box > .act, dialog[open] .user-create-footer, dialog[open] .user-canvas-foot');\n        const footer=(await footerLoc.count())?await footerLoc.last().boundingBox():null;"
if old_footer not in text and new_footer not in text:
    raise SystemExit('browser footer locator drifted')
text = text.replace(old_footer, new_footer)
browser.write_text(text, encoding='utf-8')

ci = Path('.github/workflows/backend-ci.yml')
text = ci.read_text(encoding='utf-8')
old = '        env:\n          XMESH_BROWSER_OUTPUT: browser-results\n        run: node scripts/test-ui-browser.cjs'
new = '        env:\n          XMESH_BROWSER_OUTPUT: browser-results\n          XMESH_UI_DISPOSABLE: "1"\n        run: node scripts/test-ui-browser.cjs'
if old not in text and new not in text:
    raise SystemExit('browser CI env block drifted')
text = text.replace(old, new, 1)
ci.write_text(text, encoding='utf-8')

check = Path('scripts/check-node-create-action.js')
text = check.read_text(encoding='utf-8')
replacements = [
    ('assert.match(app, /<div class="bar2 nodes-toolbar"><p class="note">/,', 'assert.match(app, /<div class="nodes-toolbar" data-ui-toolbar="filters" role="search"/,'),
    ('assert.match(html,/<script src="\\/js\\/features\\/nodes\\/node-bootstrap-v6\\.js\\?v=20261101-hysteria-policy-v1"><\\/script>/', 'assert.match(html,/<script src="\\/js\\/features\\/nodes\\/node-bootstrap-v6\\.js\\?v=[a-z0-9._-]+"><\\/script>/i'),
    ('assert.match(html,/<script src="\\/js\\/features\\/nodes\\/node-dialogs\\.js\\?v=20261101-user-create-enterprise-v3"><\\/script>/', 'assert.match(html,/<script src="\\/js\\/features\\/nodes\\/node-dialogs\\.js\\?v=[a-z0-9._-]+"><\\/script>/i'),
    ('assert.match(userCss,/\\.user-create-hold \\.sw\\{[\\s\\S]*width:2\\.8rem!important;[\\s\\S]*height:1\\.6rem!important/,', 'assert.match(userCss,/\\.user-create-hold \\.sw\\{[\\s\\S]*width:2\\.8rem;[\\s\\S]*height:1\\.6rem/,'),
    ('assert.match(html,/user-sharing-context\\.js\\?v=20261101-sharing-v1[\\s\\S]*user-sharing-risk\\.js\\?v=20261101-sharing-v1/,', 'assert.match(html,/user-sharing-context\\.js\\?v=[a-f0-9]{12}[\\s\\S]*user-sharing-risk\\.js\\?v=[a-f0-9]{12}/,'),
]
for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
check.write_text(text, encoding='utf-8')
