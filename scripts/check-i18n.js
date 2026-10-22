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
assert.equal(api.translate('QR-код для приложения-аутентификатора'),
 'QR code for an authenticator app');
assert.equal(api.translate('2. Шестизначный код из приложения-аутентификатора'),
 '2. Six-digit code from your authenticator app');
assert.equal(api.translate('Нет возможности сканировать? Добавить вручную'),
 "Can't scan the QR code? Add the account manually");

assert.equal(api.translate('Неверный логин или пароль.'),'Incorrect username or password.');
assert.equal(api.translate('Повторяющееся поле «tag»: Xray/JSON использует последнее значение, предыдущее будет потеряно.'),
 'Duplicate field «tag»: Xray/JSON uses the last value; earlier values are lost.');
assert.equal(api.translate('Название вашего сервиса'),'Your service name');
assert.equal(api.translate('3 узлов настроено. CPU, RAM и скорость требуют подключённого мониторинга.'),
 '3 nodes configured. CPU, RAM, and speed require connected monitoring.');
// Regression coverage for formerly mixed RU/EN surfaces.
for(const [ru,en] of [
 ['16 вариантов шрифта с поддержкой кириллицы. Выбор применяется ко всей панели и сохраняется в настройках','16 Cyrillic-compatible fonts. The choice applies across the panel and is saved in settings.'],
 ['Премиум клиенты','Premium clients'],
 ['Поиск пользователей','Search users'],
 ['Рабочие разделы XRAY STUDIO','XRAY STUDIO workspaces'],
 ['Новый адрес сгенерирован. Сохраните политику, чтобы применить его.','New path generated. Save the policy to apply it.'],
 ['Ошибка настроек безопасности','Security settings error'],
 ['Название профиля','Profile name'],
 ['Криптографический генератор недоступен. Используйте HTTPS.','Cryptographic random generator unavailable. Use HTTPS.']
])assert.equal(api.translate(ru),en,'Missing English translation for '+ru);
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
assert.match(html,/id="language-trigger"/,'Language control must live in the global header');
assert.match(html,/id="language-menu"/,'Header language menu must exist');
assert.match(app,/function syncTopLanguage\(\)/,'Global language menu must reflect saved locale');
assert.match(app,/languages:'<path/,'Language control must use a recognizable translation glyph');
assert.match(app,/trigger\.innerHTML=ic\('languages'\)/,'Header must render the translation icon');
assert.doesNotMatch(app,/trigger\.innerHTML=ic\('globe'\)/,'Legacy globe icon must not be used for locale switching');
assert.doesNotMatch(app,/settings-language-toggle/,'Locale selector must not remain in appearance settings');
assert.match(app,/data-panel-language/,'Language buttons must exist');
assert.match(app,/window\.XMeshMfa\?\.panel\(\)/);
assert.match(app,/class="settings-appearance-header"/,'Appearance header must remain intact');
assert.match(app,/window\.XMeshI18n\?\.setLanguage\(button\.dataset\.panelLanguage\)/,
 'Locale selection must use persisted localization preference');
assert.doesNotMatch(app,/grid-column:1\/-1"><div><h3>Язык интерфейса/,
 'A separate full-width language card must not disrupt the settings layout');
assert.match(html,/aria-pressed="false"/,
 'RU and EN buttons must expose selected-state semantics');
assert.match(app,/const panelIsEnglish=/,'Panel number and date formatting must follow locale');
assert.match(src,/#bn,#lg/,'User-defined panel brand should never be translated');
assert.match(portal,/english\?'12.4 \/ 100 GB'/,
 'Portal preview units must follow the customer-selected language, not the admin preference');
assert.match(portal,/previewRoot\.lang=lang/,'Portal must set its own language');
assert.match(portal,/previewLanguage=next/,'Customer-selected language must update the preview');
assert.match(portal,/\[\['ru','Русский'\],\['en','English'\]\]/);
assert.doesNotMatch(portal,/tr:\['Abonelik aktif'/);
assert.doesNotMatch(portal,/vi:\['Gói đăng ký/);
assert.match(backend,/"subscriptionLanguage", &\["ru", "en"\]/);
assert.match(html,/<script src="i18n\.js[^"]*"><\/script>\s*<script src="subscription-studio\.js/);
assert.match(login,/<script src="\/i18n\.js[^"]*" defer><\/script>\s*<script src="\/login\.js[^"]*" defer><\/script>/);
assert.match(docker,/COPY index\.html[^\n]*i18n\.js/);
console.log('RU/EN panel locale persistence, safe reversible translations, independent portal locale: OK');
