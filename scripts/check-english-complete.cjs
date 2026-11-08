#!/usr/bin/env node
'use strict';
// No legacy-debt allowlist: every source phrase must resolve to English.
const {runtime,candidates}=require('./ci/english-audit.cjs');
const assert=require('node:assert/strict');
const api=runtime(),phrases=candidates();const missing=[];
// Exercise real interpolated API copy, not just untranslated source templates.
assert.equal(api.translate('Например, 123456789'),'For example, 123456789');
assert.equal(
 api.translate('Узел с IP-адресом 2001:db8::abcd уже существует: «Node №1» (ID 42). Откройте существующий узел вместо повторного добавления.'),
 'A node with IP address 2001:db8::abcd already exists: “Node №1” (ID 42). Open the existing node instead of adding it again.'
);
assert.equal(
 api.translate('Узел с адресом HOST.example уже существует: «Server» (ID 8). Откройте существующий узел вместо повторного добавления.'),
 'A node with address HOST.example already exists: “Server” (ID 8). Open the existing node instead of adding it again.'
);
assert.equal(api.translate('Учётная запись, подключение и контактные данные.'),'Account, connection, and contact details.');
assert.equal(api.translate('Контактные данные'),'Contact details');
assert.equal(api.translate("Всего хостов"),"Total hosts");
assert.equal(api.translate("Активных"),"Active");
assert.equal(api.translate("Отключённых"),"Disabled");
assert.equal(api.translate("Действия с хостом"),"Host actions");
assert.equal(api.translate("Копировать адрес"),"Copy address");
assert.equal(api.translate("Адрес скопирован"),"Address copied");
assert.equal(api.translate("Не удалось скопировать адрес"),"Could not copy address");
assert.equal(api.translate("Поиск сквадов"),"Search squads");
assert.equal(api.translate("Поиск по названию, описанию или inbound"),"Search by name, description or inbound");
assert.equal(api.translate("Попробуйте другой запрос или очистите поиск."),"Try another query or clear the search.");
assert.equal(api.translate("Поиск хостов"),"Search hosts");
assert.equal(api.translate("Великобритания (UK)"),"United Kingdom (UK)");
assert.equal(api.translate("Косово"),"Kosovo");
assert.equal(api.translate("Kosovo Косово Kosova Republic of Kosovo"),"Kosovo Kosova Republic of Kosovo");
assert.equal(api.translate("Поиск по названию, адресу, профилю или inbound"),"Search by name, address, profile or inbound");
assert.equal(api.translate("Поиск команд, страниц и заметок"),"Search commands, pages and notes");
assert.equal(api.translate("Заметка: "),"Note: ");
assert.equal(api.translate("Поиск страницы, действия, пользователя или заметки"),"Search pages, actions, users or notes");
assert.equal(api.translate("Введите страницу, команду, пользователя или текст заметки"),"Enter a page, command, user or note text");
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
assert.equal(api.translate('Архивная нода'),'Archived node');
assert.equal(api.translate('Архивная нода #'),'Archived node #');
assert.equal(api.translate('Параметры settings'),'Protocol settings');

for(const [ru,en] of [
  ['Выбрано:', 'Selected:'],
  ['» к', '” to'],
  ['элементам?', 'items?'],
  ['Связанные хосты:', 'Linked hosts:'],
  ['Ошибка массовой операции:', 'Bulk action failed:'],
  ['Обработано:', 'Completed:']
]){
  assert.equal(api.translate(ru),en,'Bulk action translation should survive whitespace normalization');
}

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
