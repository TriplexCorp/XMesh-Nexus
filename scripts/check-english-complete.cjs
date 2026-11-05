#!/usr/bin/env node
'use strict';
// No legacy-debt allowlist: every source phrase must resolve to English.
const {runtime,candidates}=require('./ci/english-audit.cjs');
const assert=require('node:assert/strict');
const api=runtime(),phrases=candidates();const missing=[];
// Exercise real interpolated API copy, not just untranslated source templates.
assert.equal(api.translate('Версия v26.10.31'),'Version v26.10.31');
assert.equal(api.translate('3 мин'),'3 min');
assert.equal(api.translate('1 ч 2 мин'),'1 h 2 min');
assert.equal(api.translate('4 д 3 ч'),'4 d 3 h');
assert.equal(api.translate('Поле hwid должно быть текстом.'),'Field hwid must be text.');
assert.equal(api.translate('Не удалось сохранить: Поле hwid должно быть текстом.'),'Could not save: Field hwid must be text.');
assert.equal(api.translate('Неизвестный параметр Xray-core: path'),'Unknown Xray-core setting: path');
assert.equal(api.translate('1 строк'),'1 line');
assert.equal(api.translate('Строка 12, столбец 4'),'Line 12, column 4');
assert.equal(api.translate('Выбрать Москва'),'Select Москва','User-provided names must remain unchanged');
assert.equal(api.translate('Параметры settings'),'Protocol settings');
for(const [ru,en] of api.dict){
 assert(en.trim(),'Empty English translation: '+ru);
 assert(!/[А-Яа-яЁё]/u.test(en),'English catalog contains Russian: '+ru);
 const slots=text=>[...text.matchAll(/\{([A-Za-z_]\w*)?\}/g)].map(m=>m[1]||'').sort();
 assert.deepEqual(slots(en),slots(ru),'Translation must retain every interpolation slot: '+ru);
}
for(const [ru,files] of phrases){const en=api.translate(ru);if(/[А-Яа-яЁё]/u.test(en)||!en.trim())missing.push({ru,files:[...files]})}
if(process.argv.includes('--report'))process.stdout.write(JSON.stringify(missing,null,2)+'\n');
else if(missing.length){for(const {ru,files}of missing)console.error(files.join(', ')+': '+ru);console.error('Incomplete English: '+missing.length+' untranslated phrases. No baseline exceptions.');process.exitCode=1}
else console.log('Complete English source audit: '+phrases.size+' phrases across panel JS/HTML/CSS and API error literals; zero missing translations.');
