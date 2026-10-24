#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const intelligence=read('xray-json-intelligence.js');
const diagnostics=read('xray-json-diagnostics.js');
const app=read('app.js');
const html=read('index.html');
const docker=read('backend/Dockerfile');
new Function(intelligence);new Function(diagnostics);
const env={};
new Function('window',intelligence)(env);
new Function('window',diagnostics)(env);
const engine=env.XrayJsonDiagnostics;
const verify=cfg=>engine.inspectAll(JSON.stringify(cfg,null,2));
const profile={inbounds:[{
 tag:'main',listen:'0.0.0.0',port:443,protocol:'vless',
 settings:{users:[],decryption:'none'},
 streamSettings:{
  network:'xhttp',security:'reality',
  realitySettings:{target:'example.com:443',privateKey:'A'.repeat(43),shortIds:['1234abcd']},
  xhttpSettings:{path:'/vpn',mode:'packet-up',extra:{xPaddingBytes:'100-1000'}}
 }
}],outbounds:[{protocol:'freedom',tag:'direct'},{protocol:'blackhole',tag:'blocked'}]};
assert.deepEqual(verify(profile),[],'Normal VLESS XHTTP/Reality server profile must not trigger false positives');
const browserAutofill=JSON.parse(JSON.stringify(profile));
browserAutofill.inbounds[0].streamSettings.security='none';
browserAutofill.inbounds[0].streamSettings.realitySettings.privateKey='a'.repeat(256);
browserAutofill.inbounds[0].streamSettings.realitySettings.shortIds=['Triplex'];
const autofillIssues=verify(browserAutofill);
for(const code of ['REALITY_PRIVATEKEY_FORMAT','REALITY_INACTIVE','SHORTID_FORMAT'])
 assert(autofillIssues.some(x=>x.code===code),'Browser-autofill contamination must be detected: '+code);
assert(autofillIssues.every(x=>!x.message.includes('a'.repeat(64))),'Never echo suspected secrets in diagnostics');

assert.deepEqual(verify({outbounds:[{protocol:'freedom',tag:'direct'}]}),[],'Outbound-only configs can be valid');
const tls=JSON.parse(JSON.stringify(profile));
tls.inbounds[0].streamSettings={network:'ws',security:'tls',tlsSettings:{certificates:[]},wsSettings:{path:'/websocket'}};
assert.deepEqual(verify(tls),[],'Custom TLS/WS config should not be blocked');
const bad=JSON.parse(JSON.stringify(profile));
bad.inbounds[0].streamSettings.realitySettings.shortIds=['not hex'];
bad.inbounds[0].streamSettings.xhttpSettings.mode='packket-up';
bad.inbounds[0].streamSettings.xhttpSettings.path='vpn';
bad.inbounds[0].streamSettings.xhttpSettings.xmux={maxConcurrency:5,maxConnections:3};
bad.inbounds[0].settings.decryption='';
const issues=verify(bad);
const nestedBad=JSON.parse(JSON.stringify(profile));
nestedBad.inbounds[0].streamSettings.method='xhttp';
delete nestedBad.inbounds[0].streamSettings.network;
nestedBad.inbounds[0].streamSettings.xhttpSettings.extra.xmux={maxConcurrency:4,maxConnections:3};
assert(verify(nestedBad).some(x=>x.code==='XMUX_CONFLICT'),'Nested XHTTP extra.xmux must be analyzed');
const methodBad=JSON.parse(JSON.stringify(profile));
methodBad.inbounds[0].streamSettings.method='websocket';
delete methodBad.inbounds[0].streamSettings.network;
assert(verify(methodBad).some(x=>x.code==='REALITY_TRANSPORT'),'Method field must drive transport compatibility');

for(const code of ['SHORTID_FORMAT','XHTTP_MODE','XHTTP_PATH','XMUX_CONFLICT','VLESS_EMPTY_DECRYPTION'])
 assert(issues.some(x=>x.code===code),'Missing '+code);
assert(issues.length>=5,'Report multiple independent issues');
assert(issues.every(x=>Number.isInteger(x.line)&&x.line>0&&Number.isInteger(x.column)&&x.column>0),'Source position required');
const pathFix=issues.find(x=>x.code==='XHTTP_PATH');
assert(pathFix.fix,'Safe XHTTP path fix expected');
const src=JSON.stringify(bad,null,2), change=pathFix.fix;
const fixed=src.slice(0,change.start)+change.replacement+src.slice(change.end);
assert.equal(JSON.parse(fixed).inbounds[0].streamSettings.xhttpSettings.path,'/vpn');
assert(engine.inspectAll(fixed).every(x=>x.code!=='XHTTP_PATH'));
const misspell='{ "inbounds": [{"protcol":"vless","port":443}] }';
const typo=engine.inspectAll(misspell).find(x=>x.code==='MISSPELLED_KEY');
assert(typo&&typo.fix,'Protocol typo should offer targeted fix');
const after=misspell.slice(0,typo.fix.start)+typo.fix.replacement+misspell.slice(typo.fix.end);
assert.equal(JSON.parse(after).inbounds[0].protocol,'vless');
const repeated='{\n "inbounds":[{"protocol":"vless","protocol":"trojan","port":443}]\n}';
assert(engine.inspectAll(repeated).some(x=>x.code==='DUPLICATE_KEY'),'Detect duplicate keys');
const incompatible={inbounds:[{protocol:'vless',port:443,settings:{decryption:'none'},streamSettings:{network:'ws',security:'reality'}}]};
const findings=verify(incompatible);
assert(findings.some(x=>x.code==='REALITY_TRANSPORT'));
assert(findings.some(x=>x.code==='REALITY_MISSING'));
const route={outbounds:[{tag:'direct',protocol:'freedom'}],routing:{rules:[{type:'field',domain:['example.com'],outboundTag:'missing'}]}};
assert(verify(route).some(x=>x.code==='MISSING_OUTBOUND_TAG'));
const invalid='{"inbounds":[{"protocol":"vless",, "tag":"node","port":443}]}';
assert.equal(engine.inspectAll(invalid).length,1,'Syntax error comes before semantic analysis');
assert(engine.inspectAll(invalid)[0].fix,'Keep legacy syntax Hot Fix');
assert.match(engine.decorateRun('<script>',0,'jx-string',null),/&lt;script&gt;/);
assert.match(engine.decorateRun('abc',0,'jx-string',[{start:1,end:2,message:'bad',severity:'warning'}]),/is-warning/);
assert.match(intelligence,/MAX_BYTES=900000/,'Cap expensive semantic analysis');
assert.match(diagnostics,/sr-json-issue-list/,'Issue list must exist');
assert.match(fs.readFileSync('xray-studio-v4.js','utf8'),/XrayJsonIntelligence\?\.analyze\?\.\(source,obj\)/,'Active Studio v4 invokes semantic engine');
assert.match(html,/<script src="xray-json-intelligence\.js[^"]*"><\/script>\s*<script src="xray-json-diagnostics\.js/);
assert.match(docker,/COPY [^\n]*xray-json-intelligence\.js[^\n]* \/app\/static\//);
console.log('Intelligent Xray JSON validation: OK');
