#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('frontend/js/core/app.js','utf8');
const style=fs.readFileSync('frontend/styles/features/templates/templates.css','utf8');
const index=fs.readFileSync('frontend/styles/system/nexus-ui-v3.css','utf8');
const page=fs.readFileSync('frontend/index.html','utf8');
const i18n=fs.readFileSync('frontend/js/core/i18n.js','utf8');
assert.match(app,/templates:\['Шаблоны',templatesP\]/,'Templates must use their own card workspace');
assert.match(app,/data-template-search-text/,'Template search needs a scoped, precomputed index');
assert.match(app,/data-template-create-user/,'User templates must offer one-click creation');
assert.match(app,/data-template-duplicate/,'Template cards must allow duplication');
assert.match(app,/select\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/,
  'Creating a user from a template must invoke the existing preset autofill logic');
assert.match(app,/t\.id=='tplsel'/,'Template autofill handler must remain connected');
assert.match(app,/data-ne="tpls:/,'User template card editing must use canonical CRUD');
assert.match(app,/data-ne="subs:/,'Subscription draft editing must use canonical CRUD');
assert.doesNotMatch(app,/function templatesP[\s\S]*?async function simple\(ks\)[\s\S]*?applySubscriptionTemplate/,
  'Subscription drafts must not invent unsupported live application');
assert.match(style,/\.template-grid\{display:grid;grid-template-columns:repeat\(auto-fill/,
  'Template cards need responsive grid tracks');
assert.match(style,/\.template-card\[hidden\]\{display:none\}/,
  'Live search must hide cards without remounting');
assert.match(index,/\.\.\/features\/templates\/templates\.css\?v=[a-f0-9]{12}/,
  'Template styling must share the canonical design system');
assert.match(page,/nexus-ui-v3\.css\?v=[a-f0-9]{12}/);
const start=app.indexOf('/* Templates share the canonical CRUD');
const end=app.indexOf('async function simple(ks)',start);
assert(start>=0&&end>start,'Templates workspace implementation must be discoverable');
const code=app.slice(start,end);
new Function('api','DB','ic','esc','STRAT','document','entForm','userNew','Event',code);
const users=[
  {id:7,name:'Премиум',limit:0,days:30,hwid:2,strategy:'NO_RESET',squads:[3],hold:false},
  {id:8,name:'Старт',limit:100,days:7,hwid:1,strategy:'WEEK',squads:[],hold:true}
];
const subs=[{id:11,name:'Xray draft',fmt:'XRAY_JSON',content:'{"outbounds":[]}'}];
const DB={tpls:users,subs,squads:[{id:3,name:'TLS'}]};
const api={list:async type=>({items:DB[type]})};
const icon=name=>'<i data-icon="'+name+'"></i>';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const callbacks={};
const queryInput={value:'',dataset:{templateSearch:'tpls'}};
const cards=[
  {dataset:{templateSearchText:'Премиум TLS'},hidden:false},
  {dataset:{templateSearchText:'Старт'},hidden:false}
];
const clear={hidden:true},empty={hidden:true},counter={textContent:''};
const section={
 querySelector:selector=>selector==='[data-template-search]'?queryInput:
   selector==='[data-template-clear]'?clear:
   selector==='[data-template-no-results]'?empty:
   selector==='[data-template-count]'?counter:null,
 querySelectorAll:selector=>selector==='[data-template-card]'?cards:[]
};
const root={
 addEventListener:(name,callback)=>callbacks[name]=callback,
 querySelectorAll:()=>[],
 querySelector:selector=>selector==='[data-template-section="tpls"]'?section:null
};
const chooser={value:'',events:[],dispatchEvent(event){this.events.push(event.type)}};
const document={querySelector:selector=>selector==='.templates-workspace'?root:
  selector==='#tplsel'?chooser:null};
const edits=[];let created=0;
const factory=new Function('api','DB','ic','esc','STRAT','document','entForm','userNew','Event',
  code+';return templatesP;');
const render=factory(api,DB,icon,escape,[
  ['NO_RESET','Не сбрасывать'],['WEEK','Каждую неделю']
],document,(...args)=>edits.push(args),()=>{created++},Event);
(async()=>{
 const [html,mount]=await render();
 assert.match(html,/class="templates-workspace"/);
 assert.equal((html.match(/data-template-card="tpls:/g)||[]).length,2);
 assert.equal((html.match(/data-template-card="subs:/g)||[]).length,1);
 assert.match(html,/data-template-create-user="7"/);
 assert.match(html,/data-template-duplicate="tpls:7"/);
 assert.match(html,/data-ne="tpls:7"/);
 assert.match(html,/data-ne="subs:11"/);
 assert.match(html,/Не применяется к подпискам автоматически/);
 assert.doesNotMatch(html,/data-ui-layout="table"/);
 assert.match(html,/SUBSCRIPTION STUDIO/);
 mount();
 assert.equal(counter.textContent,'');
 assert.match(html,/role="tablist"/);
 assert.match(html,/class="template-section-tools nx-workspace-toolbar"[^>]*><nav class="templates-tabs"/,
   'Type tabs must live inside the active collection toolbar');
 assert.doesNotMatch(html,/data-ui-page="templates"><nav class="templates-tabs"/,
   'There must be no standalone type-tab row above the toolbar');
 assert.equal((html.match(/class="templates-tabs"/g)||[]).length,1,
   'Exactly one tablist must exist even when both collections have records');
 assert.doesNotMatch(html,/templates-kicker|templates-heading-actions/);
 queryInput.value='Премиум';
 callbacks.input({target:{closest:selector=>selector==='[data-template-search]'?queryInput:null}});
 assert.equal(cards[0].hidden,false);
 assert.equal(cards[1].hidden,true);
 assert.equal(counter.textContent,'1 / 2');
 queryInput.value='___not_found___';
 callbacks.input({target:{closest:selector=>selector==='[data-template-search]'?queryInput:null}});
 assert.equal(empty.hidden,false);
 assert.equal(cards[0].hidden,true);
 callbacks.keydown({target:{closest:selector=>selector==='[data-template-search]'?queryInput:null},
  key:'Escape',preventDefault(){}});
 assert.equal(cards.every(card=>!card.hidden),true);
 assert.equal(queryInput.value,'');
 function click(selector,dataset){
   callbacks.click({target:{closest:key=>key===selector?{dataset}:null}});
 }
 click('[data-template-duplicate]',{templateDuplicate:'tpls:7'});
 assert.equal(edits.length,1);
 assert.equal(edits[0][0],'tpls');
 assert.equal(edits[0][1],null);
 assert.equal(edits[0][2].name,'Премиум · копия');
 assert(!('id' in edits[0][2]),'Clones must not reuse record IDs');
 click('[data-template-create-user]',{templateCreateUser:'7'});
 assert.equal(created,1);
 assert.equal(chooser.value,'7');
 assert.deepEqual(chooser.events,['change']);
 DB.subs=[];
 const [withoutSubs]=await render();
 assert.match(withoutSubs,/Шаблонов подписки пока нет/);
 assert.match(withoutSubs,/data-ne="subs"/);
 assert.doesNotMatch(withoutSubs,/class="tw"/);
 const win={};
 const locale=new Function('window','localStorage','document',i18n+';return window.XMeshI18n;')(
   win,{getItem:()=> 'en',setItem(){}},{readyState:'loading',addEventListener(){},documentElement:{lang:'en'}});
 for(const ru of ['Управление пресетами','Шаблон пользователя','Действия с шаблоном',
  'С первого подключения','Пока нет шаблонов пользователей']){
   const translated=locale.translate(ru);
   assert.notEqual(translated,ru,'Missing English text: '+ru);
   assert(!/[А-Яа-яЁё]/.test(translated),'English UI must not leak Russian: '+ru);
 }
 console.log('Premium templates: card rendering, search, CRUD, cloning, user preset, empty state and locale OK.');
})().catch(error=>{console.error(error);process.exitCode=1});
