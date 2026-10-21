#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const src=fs.readFileSync('i18n.js','utf8');
const app=fs.readFileSync('app.js','utf8');
const portal=fs.readFileSync('subscription-studio.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const login=fs.readFileSync('login.html','utf8');
const docker=fs.readFileSync('backend/Dockerfile','utf8');
const backend=fs.readFileSync('backend/src/main.rs','utf8');

new Function(src);new Function(app);new Function(portal);
const text={nodeType:3,nodeValue:'Настройки',parentElement:{closest:()=>null}};
const raw={nodeType:3,nodeValue:'CustomerServiceABC',parentElement:{closest:()=>null}};
const preview={nodeType:3,nodeValue:'Подписка активна',parentElement:{closest:()=>true}};
const nodes=[text,raw,preview];
const element={nodeType:1,hasAttribute:()=>false,closest:()=>null};
const document={
 readyState:'loading',
 documentElement:{lang:'ru',nodeType:1,hasAttribute:()=>false,closest:()=>null},
 addEventListener(){},
 dispatchEvent(){},
 createTreeWalker(){let index=-1;return {nextNode(){index++;return index<nodes.length},get currentNode(){return nodes[index]}}},
 title:'',
};
const store={value:'en',getItem(){return this.value},setItem(key,v){this.value=v}};
const env={window:{},document,localStorage:store,NodeFilter:{SHOW_ELEMENT:1,SHOW_TEXT:4},CustomEvent:class{constructor(name,data){this.type=name;this.detail=data.detail}}};
vm.runInNewContext(src,env);
const api=env.window.XMeshI18n;
assert.equal(api.getLanguage(),'en');
assert.equal(api.translate('Узлы'),'Nodes');
assert.equal(api.translate('Название подписки'),'Subscription name');
assert.equal(api.translate('Неверный логин или пароль.'),'Incorrect username or password.');
assert.equal(api.translate('Повторяющееся поле «tag»: Xray/JSON использует последнее значение, предыдущее будет потеряно.'),
 'Duplicate field «tag»: Xray/JSON uses the last value; earlier values are lost.');
assert.equal(api.translate('Название вашего сервиса'),'Your service name');
assert.equal(api.translate('3 узлов настроено. CPU, RAM и скорость требуют подключённого мониторинга.'),
 '3 nodes configured. CPU, RAM, and speed require connected monitoring.');
api.apply(document);
assert.equal(text.nodeValue,'Settings');
assert.equal(raw.nodeValue,'CustomerServiceABC');
assert.equal(preview.nodeValue,'Подписка активна','Portal preview must keep its own independent locale');
assert.equal(document.documentElement.lang,'en');
api.setLanguage('ru');
assert.equal(text.nodeValue,'Настройки','Locale switching must restore original language');
assert.equal(store.value,'ru','Preference must persist in browser');
api.setLanguage('en');
assert.equal(text.nodeValue,'Settings','Switching back to English must still work');
assert.match(app,/id="ui-language"/);
assert.match(app,/const panelIsEnglish=/,'Panel number and date formatting must follow locale');
assert.match(src,/#bn,#lg/,'User-defined panel brand should never be translated');
assert.match(portal,/d.subscriptionLanguage==='en'\?'12.4 \/ 100 GB'/,
 'Portal preview should use its own configured units');
assert.match(app,/XMeshI18n\?\.setLanguage\(t\.value\)/);
assert.match(portal,/\[\['ru','Русский'\],\['en','English'\]\]/);
assert.doesNotMatch(portal,/tr:\['Abonelik aktif'/);
assert.doesNotMatch(portal,/vi:\['Gói đăng ký/);
assert.match(backend,/"subscriptionLanguage", &\["ru", "en"\]/);
assert.match(html,/<script src="i18n\.js[^"]*"><\/script>\s*<script src="subscription-studio\.js/);
assert.match(login,/<script src="\/i18n\.js[^"]*" defer><\/script>\s*<script src="\/login\.js"/);
assert.match(docker,/COPY index\.html[^\n]*i18n\.js/);
console.log('RU/EN panel locale persistence, safe reversible translations, independent portal locale: OK');
