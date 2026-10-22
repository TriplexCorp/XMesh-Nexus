/* Context-aware non-destructive JSON editing tools. */
window.XMeshJsonTools=(()=>{
'use strict';
function setup(root,{toast,realityKeys}){
const area=root.querySelector('[data-xm="manual"]');
const host=root.querySelector('[data-xm-tools]');
if(!area||!host)return;
let undo=[],redo=[],last=area.value;
const clone=o=>JSON.parse(JSON.stringify(o));
const notify=(m)=>toast?.(m);
const snapshot=()=>{if(area.value!==last){undo.push(last);if(undo.length>80)undo.shift();last=area.value;redo=[]}update()};
const update=()=>{const undoButton=host.querySelector('[data-tool="undo"]'),redoButton=host.querySelector('[data-tool="redo"]');if(undoButton)undoButton.disabled=undo.length===0;if(redoButton)redoButton.disabled=redo.length===0};
const commit=(value,msg)=>{snapshot();const from=area.value;if(value===from)return;undo.push(from);if(undo.length>80)undo.shift();redo=[];area.value=value;last=value;area.dispatchEvent(new Event('input',{bubbles:true}));area.focus();update();notify(msg||'JSON обновлён')};
const parse=()=>{try{const x=JSON.parse(area.value);if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Корень должен быть объектом');return x}catch(e){throw Error('Исправьте синтаксис JSON перед применением: '+e.message)}};
const dialog=window.XMeshStudioDialogs;
const ensureDialogs=()=>{if(!dialog?.request||!dialog?.confirm)throw Error('Диалоговый модуль XRAY STUDIO не загрузился. Обновите страницу без кеша.')};
const getInbound=(data,index=0)=>{
 if(!Array.isArray(data.inbounds)||!data.inbounds.length)throw Error('В конфигурации нет inbound');
 const item=data.inbounds[index];if(!item)throw Error('Выбранный inbound отсутствует');return item;
};
async function chooseInbound(){
 ensureDialogs();
 const source=area.value,data=parse();
 if(!Array.isArray(data.inbounds)||!data.inbounds.length)throw Error('В конфигурации нет inbound');
 if(data.inbounds.length===1)return {index:0,source,tag:data.inbounds[0].tag};
 const result=await dialog.request({
  title:'Выберите inbound',
  description:'Укажите соединение, к которому нужно применить инструмент. Другие inbound не изменятся.',
  confirmLabel:'Продолжить',
  fields:[{name:'index',label:'Входящее соединение',type:'select',wide:true,value:'0',
   options:data.inbounds.map((x,i)=>({value:String(i),label:(x.tag||'Inbound '+(i+1))+' · '+String(x.protocol||'unknown').toUpperCase()+' · порт '+(x.port||'—')}))}]
 });
 if(!result)return null;
 const index=Number(result.index);
 if(!Number.isInteger(index)||index<0||index>=data.inbounds.length)throw Error('Некорректный inbound');
 return {index,source,tag:data.inbounds[index].tag};
}
async function mutateInbound(fn,label){
 try{
  const selected=await chooseInbound();if(!selected)return false;
  if(area.value!==selected.source){notify('JSON изменился во время выбора inbound. Повторите действие.');return false}
  return mutate(d=>{
   const ib=getInbound(d,selected.index);
   if(ib.tag!==selected.tag)throw Error('Выбранный inbound изменился');
   return fn(ib,d);
  },label);
 }catch(e){status('Ошибка: '+e.message);notify(e.message);return false}
}
const mutate=(fn,label)=>{try{const data=parse(),before=JSON.stringify(data),changed=fn(data);if(changed===false)return false;const after=JSON.stringify(data);if(after===before){status('Без изменений');notify('Изменений нет');return false}commit(JSON.stringify(data,null,2),label);status(label);return true}catch(e){status('Ошибка: '+e.message);notify(e.message);return false}};
const freshUUID=()=>{if(crypto.randomUUID)return crypto.randomUUID();const a=new Uint8Array(16);crypto.getRandomValues(a);a[6]=a[6]&15|64;a[8]=a[8]&63|128;const h=Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-')};
const hex=(n)=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')};
const snippets={
 'dns':{servers:['1.1.1.1','9.9.9.9'],queryStrategy:'UseIPv4'},
 'routing':{domainStrategy:'AsIs',rules:[]},
 'policy':{levels:{'0':{statsUserUplink:true,statsUserDownlink:true}},system:{statsInboundUplink:true,statsInboundDownlink:true}},
 'stats':{},
 'outbounds':[{tag:'direct',protocol:'freedom'},{tag:'block',protocol:'blackhole'}],
 'log':{loglevel:'warning'}
};
const tools=[
 ['undo','↶ Отменить'],['redo','↷ Повторить'],['find','⌕ Поиск'],['validate','✓ Проверить'],
 ['reality','✦ Reality X25519'],['shortid','♯ Short ID'],
 ['dns','◉ DNS'],['routing','⇄ Routing'],['policy','▥ Policy / Stats'],['outbounds','⬡ Outbounds'],['log','Log'],
 ['inbound','Новый inbound'],['xhttp','XHTTP настройки'],['vlessens','VLESS Encryption'],['finalmask','FinalMask'],['hysteria','Hysteria2 inbound'],['uuid','UUID (скопировать)'],['backup','Скачать JSON'],['format','Форматировать']
];
const details={reality:['Ключи X25519 для Reality','key-round'],shortid:['Генерация Short ID','hash'],dns:['Настройка DNS-серверов','globe'],routing:['Правила маршрутизации','route'],policy:['Политики и статистика','chart-no-axes-column'],outbounds:['Исходящие соединения','network'],validate:['Проверка через Xray-core','shield-check'],xhttp:['Транспорт XHTTP','network'],vlessens:['Серверный VLESS Encryption','shield'],finalmask:['Маскировка потоков','layers'],hysteria:['Шаблон Hysteria2','radio'],uuid:['Скопировать UUID','fingerprint'],backup:['Экспорт текущего JSON','download'],inbound:['Добавить серверный inbound','plus']};
const featured=['reality','shortid','xhttp','dns','routing','inbound'];
const icons={
 reality:'<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="m9 12 2 2 4-4"/>',
 shortid:'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',
 xhttp:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
 dns:'<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
 routing:'<path d="M4 7h14l-3-3m3 3-3 3M20 17H6l3-3m-3 3 3 3"/>',
 inbound:'<path d="M12 3v13m-5-5 5 5 5-5M4 19h16"/>'
};
host.innerHTML='<div class="xm-tools-grid">'+featured.map(id=>{const item=tools.find(x=>x[0]===id),meta=details[id];return '<button type="button" class="sv-toolitem sv-tool-'+id+'" data-tool="'+id+'" title="'+meta[0]+'" aria-label="'+meta[0]+'"><span class="sv-tool-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[id]+'</svg></span><span class="sv-tool-label">'+item[1].replace(/^[^A-Za-zА-Яа-яЁё0-9]+/,'')+'</span></button>'}).join('')+'</div><div class="sv-tool-issue" data-tool-issue hidden><span data-tool-issue-message></span><button type="button" data-tool="repair-shortids">Исправить Short ID</button></div><span data-tool-status class="xm-tools-status" role="status" aria-live="polite"></span>';
const status=msg=>{const e=host.querySelector('[data-tool-status]');if(e)e.textContent=msg};
const focusJsonSection=(key,title=key)=>{
 const find='"'+key+'"',pos=area.value.indexOf(find);
 if(pos<0)return false;
 area.focus();area.setSelectionRange(pos,pos+find.length);
 status(title+': редактируйте параметры в JSON');
 return true;
};
const insertAtCursor=(value)=>{const start=area.selectionStart,end=area.selectionEnd;commit(area.value.slice(0,start)+value+area.value.slice(end),'Вставлено в редактор');area.setSelectionRange(start,start+value.length)};

const shortIdValid=value=>typeof value==='string'&&/^(?:[0-9a-fA-F]{2}){0,8}$/.test(value);
const newShortId=used=>{for(let n=0;n<32;n++){const candidate=hex(8);if(!used.has(candidate)){used.add(candidate);return candidate}}throw Error('Не удалось получить уникальный Short ID')};
const repairIds=(list,append)=>{
 if(!Array.isArray(list))throw Error('realitySettings.shortIds должен быть массивом');
 const used=new Set(),bad=new Set();
 for(let i=0;i<list.length;i++){
   const value=list[i],normalized=typeof value==='string'?value.toLowerCase():'';
   if(!shortIdValid(value)||used.has(normalized))bad.add(i);
   else used.add(normalized);
 }
 if(bad.size)return list.map((x,i)=>bad.has(i)?newShortId(used):x);
 if(append||!list.length)return [...list,newShortId(used)];
 return [...list];
};
async function setReality(){
 let documentValue,inbound;
 try{
   documentValue=parse();inbound=getInbound(documentValue);if(!inbound)return;
   const stream=inbound.streamSettings||{},transport=stream.network||'raw';
   if(!['raw','xhttp','grpc'].includes(transport))throw Error('REALITY поддерживает только RAW, XHTTP или gRPC. Сначала измените транспорт.');
 }catch(e){status('Ошибка: '+e.message);notify(e.message);return}
 const originalSource=area.value;
 const selectedTag=inbound.tag;
 const selectedIndex=documentValue.inbounds.indexOf(inbound);
 const existing=inbound.streamSettings?.realitySettings||{};
 let target=existing.target||existing.dest||'';
 if(!target){
   target=prompt('Укажите собственный REALITY target (HTTPS-домен:порт). Проверьте SNI и доступность сайта:', 'www.microsoft.com:443');
   if(target===null)return;
 }
 target=target.trim();
 const match=target.match(/^([a-zA-Z0-9.-]+):(\d{1,5})$/);
 if(!match||Number(match[2])<1||Number(match[2])>65535||!match[1].includes('.')||match[1].includes('..')){
   notify('REALITY target должен иметь формат домен:порт, например www.microsoft.com:443');return;
 }
 const savedSni=Array.isArray(existing.serverNames)?existing.serverNames.filter(v=>typeof v==='string'&&v.trim()):[];
 const sni=savedSni.length?savedSni:[match[1]];
 const oldPrivate=typeof existing.privateKey==='string'?existing.privateKey.trim():'';
 const usablePrivate=oldPrivate.length>0&&!/REPLACE|YOUR[_-]?KEY|example/i.test(oldPrivate);
 // Default is always to preserve working keys. Rotation requires explicit consent.
 let generate=!usablePrivate;
 if(usablePrivate){
   generate=confirm('REALITY уже имеет privateKey. Сгенерировать НОВУЮ пару X25519? Это отключит старые клиентские public keys. Нажмите «Отмена», чтобы сохранить существующий ключ и только проверить параметры.');
 }
 let ids;
 try{ids=repairIds(existing.shortIds??[],false);if(ids===null)return}catch(e){notify(e.message);return}
 try{
   const keys=generate?await realityKeys():null;
   if(area.value!==originalSource){notify('JSON изменился за время операции. Ничего не заменено; повторите действие.');return}
   if(generate&&(!keys?.privateKey||!keys?.publicKey))throw Error('Генератор Reality не вернул пару ключей');
   const ok=mutate(doc=>{
     // Protect the selected inbound when the user has several profiles.
     const updated=doc.inbounds[selectedIndex];
     if(!updated||updated.tag!==selectedTag)throw Error('Выбранный inbound изменился, отмените операцию и выберите его снова');
     const ss=updated.streamSettings??={};
     ss.security='reality';
     const rs=ss.realitySettings??={};
     if(!rs.target&&!rs.dest)rs.target=target;
     rs.show=rs.show??false;
     if(!Array.isArray(rs.serverNames)||!rs.serverNames.length)rs.serverNames=sni;
     rs.shortIds=ids;
     if(generate)rs.privateKey=keys.privateKey;
   },generate?'REALITY настроен: ключи и Short ID созданы':'REALITY: существующий privateKey сохранён');
   if(!ok)return;
   if(generate){
     try{await navigator.clipboard.writeText(keys.publicKey);notify('REALITY обновлён; новый publicKey скопирован. Проверьте Xray-core.')}
     catch{notify('REALITY обновлён. Скопируйте новый publicKey: '+keys.publicKey)}
   }else notify('REALITY: действующий privateKey сохранён, проверьте конфигурацию ядром.');
 }catch(e){status('Ошибка: '+e.message);notify(e.message)}
}

const invalidRealityIds=data=>{
 const result=[];
 if(!Array.isArray(data.inbounds))return result;
 data.inbounds.forEach((inbound,index)=>{
  if(inbound?.streamSettings?.security!=='reality')return;
  const list=inbound.streamSettings.realitySettings?.shortIds;
  if(!Array.isArray(list))return;
  const seen=new Set();
  list.forEach((id,i)=>{
   const normal=typeof id==='string'?id.toLowerCase():'';
   if(!shortIdValid(id)||seen.has(normal))result.push({index,position:i});
   else seen.add(normal);
  });
 });
 return result;
};
const replaceBadIds=list=>{
 const used=new Set();
 return list.map(id=>{
  const key=typeof id==='string'?id.toLowerCase():'';
  if(shortIdValid(id)&&!used.has(key)){used.add(key);return id}
  return newShortId(used);
 });
};
const refreshIssues=()=>{
 const container=host.querySelector('[data-tool-issue]');
 if(!container)return;
 let data;
 try{if(area.value.length>512*1024){container.hidden=true;return}data=parse()}catch{container.hidden=true;return}
 const problems=invalidRealityIds(data);
 container.hidden=!problems.length;
 if(problems.length){
  const message=host.querySelector('[data-tool-issue-message]');
  if(message)message.textContent='Найдено '+problems.length+' неверных или повторяющихся Short ID в REALITY. Исправить автоматически?';
 }
};
const operations={
 undo(){if(!undo.length)return;redo.push(area.value);const value=undo.pop();area.value=value;last=value;area.dispatchEvent(new Event('input',{bubbles:true}));update()},
 redo(){if(!redo.length)return;undo.push(area.value);area.value=redo.pop();last=area.value;area.dispatchEvent(new Event('input',{bubbles:true}));update()},
 find(){const q=prompt('Найти текст в JSON:');if(!q)return;const pos=area.value.toLowerCase().indexOf(q.toLowerCase(),area.selectionEnd);const i=pos>=0?pos:area.value.toLowerCase().indexOf(q.toLowerCase());if(i>=0){area.focus();area.setSelectionRange(i,i+q.length);status('Найдено: '+q)}else status('Совпадений нет')},
 validate(){const button=root.querySelector('[data-action="check"]');if(button){button.click();return}try{const data=parse();const issues=window.XrayJsonIntelligence?.analyze?.(area.value,data)||[];const errors=issues.filter(i=>i.severity==='error');const warn=issues.filter(i=>i.severity==='warning');status(errors.length+' ошибок · '+warn.length+' предупреждений');if(errors[0]){const x=errors[0];area.focus();if(Number.isInteger(x.start))area.setSelectionRange(x.start,x.end||x.start+1)}notify(errors.length?'Найдены ошибки в JSON':'Синтаксис JSON корректен; полная проверка требует Xray-core')}catch(e){status(e.message);notify(e.message)}},
 async reality(){return setReality()},
 'repair-shortids'(){mutate(d=>{
   const problems=invalidRealityIds(d);
   if(!problems.length){notify('Некорректных Short ID нет');return false}
   const inboundIds=[...new Set(problems.map(x=>x.index))];
   if(!confirm('Исправить '+problems.length+' некорректных/повторяющихся Short ID в '+inboundIds.length+' inbound? Остальные данные сохранятся. Клиентам со старыми Short ID потребуется обновление.'))return false;
   for(const index of inboundIds){
    const rs=d.inbounds[index].streamSettings.realitySettings;
    rs.shortIds=replaceBadIds(rs.shortIds);
   }
 },'Некорректные Reality Short ID исправлены')},
 shortid(){mutate(d=>{
   const inbound=getInbound(d);if(!inbound)return false;
   const ss=inbound.streamSettings;
   if(!ss||ss.security!=='reality')throw Error('Для Short ID сначала включите REALITY кнопкой Reality X25519');
   const rs=ss.realitySettings;
   if(!rs||typeof rs!=='object'||Array.isArray(rs))throw Error('Отсутствует realitySettings. Настройте Reality');
   const ids=repairIds(rs.shortIds??[],true);
   if(ids===null)return false;rs.shortIds=ids;
 },'Reality Short ID проверены и обновлены')},
 dns(){let existed=false;const ok=mutate(d=>{if(d.dns&&typeof d.dns==='object'){existed=true;return false}d.dns=clone(snippets.dns)},'DNS добавлен');if(existed||ok)focusJsonSection('dns','DNS')},
 routing(){let existed=false;const ok=mutate(d=>{if(d.routing&&typeof d.routing==='object'){existed=true;return false}d.routing=clone(snippets.routing)},'Routing добавлен');if(existed||ok)focusJsonSection('routing','Routing')},
 policy(){mutate(d=>{d.policy??=clone(snippets.policy);d.stats??=clone(snippets.stats)},'Policy и Stats добавлены')},
 outbounds(){mutate(d=>{d.outbounds??=[];const existing=new Set(d.outbounds.map(x=>x.tag));for(const x of snippets.outbounds)if(!existing.has(x.tag))d.outbounds.push(clone(x))},'Outbounds добавлены')},
 log(){mutate(d=>{d.log??=clone(snippets.log)},'Логирование добавлено')},
 inbound(){mutate(d=>{d.inbounds??=[];const tag=prompt('Тег нового inbound:','new-inbound');if(tag===null)return false;if(!/^[\w.-]{1,64}$/.test(tag)||d.inbounds.some(i=>i.tag===tag))throw Error('Тег пустой, невалидный или уже существует');d.inbounds.push({tag,listen:'127.0.0.1',port:443,protocol:'vless',settings:{users:[],decryption:'none'},streamSettings:{network:'raw',security:'none'}})},'Новый локальный inbound создан. Перед публикацией настройте защиту.')},
 xhttp(){let existed=false;const ok=mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;const ss=inbound.streamSettings??={};if(ss.network==='xhttp'&&ss.xhttpSettings&&typeof ss.xhttpSettings==='object'){existed=true;return false}if(ss.network!=='xhttp'&&ss.network!=='raw'&&!confirm('Сменить транспорт выбранного inbound на XHTTP?'))return false;ss.network='xhttp';ss.xhttpSettings??={path:'/xhttp',mode:'auto'}},'XHTTP добавлен');if(existed||ok)focusJsonSection('xhttpSettings','XHTTP')},
 vlessens(){mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;if(inbound.protocol!=='vless')throw Error('VLESS Encryption доступен только для VLESS');const current=inbound.settings?.decryption||'none';const value=prompt('Серверный decryption из xray vlessenc. Безопасно отменить:',current);if(value===null)return false;(inbound.settings??={users:[]}).decryption=value.trim()||'none'},'VLESS Encryption обновлён')},
 finalmask(){mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;const current=inbound.streamSettings?.finalmask||{};const raw=prompt('FinalMask JSON для streamSettings.finalmask:',JSON.stringify(current,null,2));if(raw===null)return false;const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('FinalMask должен быть объектом');inbound.streamSettings??={};if(Object.keys(value).length)inbound.streamSettings.finalmask=value;else delete inbound.streamSettings.finalmask},'FinalMask обновлён')},
 hysteria(){mutate(d=>{d.inbounds??=[];const tag='hysteria-'+(d.inbounds.length+1);if(d.inbounds.some(x=>x.tag===tag))throw Error('Тег уже занят');d.inbounds.push({tag,listen:'127.0.0.1',port:4433,protocol:'hysteria',settings:{version:2,users:[]},streamSettings:{network:'hysteria',security:'tls',hysteriaSettings:{version:2},tlsSettings:{certificates:[]}}});notify('Заполните TLS-сертификаты и пользователей, затем проверьте ядром Xray-core.')},'Черновик Hysteria2 создан')},
 uuid(){const value=freshUUID();navigator.clipboard?.writeText(value).then(()=>notify('UUID скопирован')).catch(()=>prompt('Скопируйте UUID:',value))||prompt('Скопируйте UUID:',value)},
 backup(){const blob=new Blob([area.value],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='xray-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},
  format(){try{commit(JSON.stringify(parse(),null,2),'JSON отформатирован')}catch(e){notify(e.message)}}
};
host.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b&&operations[b.dataset.tool])Promise.resolve(operations[b.dataset.tool]()).catch(x=>notify(x.message))});
area.addEventListener('input',()=>{snapshot();refreshIssues()});
area.addEventListener('xmesh:reset-history',()=>{undo=[];redo=[];last=area.value;update()});
area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();operations.undo()}if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||e.shiftKey&&e.key.toLowerCase()==='z')){e.preventDefault();operations.redo() }});
update();refreshIssues();
}
return {setup};
})();