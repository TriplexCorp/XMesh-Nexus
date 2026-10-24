/* Context-aware non-destructive JSON editing tools. */
window.XMeshJsonTools=(()=>{
'use strict';
function setup(root,{toast,realityKeys,apiRequest}){
const area=root.querySelector('[data-xm="manual"]');
const host=root.querySelector('[data-xm-tools]');
if(!area||!host)return;
let undo=[],redo=[],last=area.value;
const clone=o=>JSON.parse(JSON.stringify(o));
const notify=(m)=>toast?.(m);
const snapshot=()=>{if(area.value!==last){undo.push(last);if(undo.length>80)undo.shift();last=area.value;redo=[]}update()};
const update=()=>{const undoButton=host.querySelector('[data-tool="undo"]'),redoButton=host.querySelector('[data-tool="redo"]');if(undoButton)undoButton.disabled=undo.length===0;if(redoButton)redoButton.disabled=redo.length===0};
const commit=(value,msg)=>{snapshot();const from=area.value;if(value===from)return;const start=area.selectionStart,end=area.selectionEnd,scrollTop=area.scrollTop,scrollLeft=area.scrollLeft;undo.push(from);if(undo.length>80)undo.shift();redo=[];area.value=value;last=value;area.dispatchEvent(new Event('input',{bubbles:true}));if(Number.isInteger(start)&&Number.isInteger(end))area.setSelectionRange(Math.min(start,value.length),Math.min(end,value.length));if(scrollTop!=null)area.scrollTop=scrollTop;if(scrollLeft!=null)area.scrollLeft=scrollLeft;update();notify(msg||'JSON обновлён')};
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
 ['reality','✦ REALITY'],['shortid','♯ Short ID'],['vision','XTLS Vision'],
 ['dns','◉ DNS'],['routing','⇄ Routing'],['policy','▥ Policy / Stats'],['outbounds','⬡ Outbounds'],['log','Log'],
 ['inbound','Новый inbound'],['xhttp','XHTTP настройки'],['vlessens','VLESS Encryption'],['finalmask','FinalMask'],['hysteria','Hysteria2 inbound'],['uuid','UUID (скопировать)'],['backup','Скачать JSON'],['format','Форматировать']
];
const details={reality:['Настроить REALITY: target, SNI, Short ID и X25519','key-round'],shortid:['Генерация Short ID','hash'],vision:['XTLS rprx Vision','shield-check'],dns:['Настройка DNS-серверов','globe'],routing:['Правила маршрутизации','route'],policy:['Политики и статистика','chart-no-axes-column'],outbounds:['Исходящие соединения','network'],validate:['Проверка через Xray-core','shield-check'],xhttp:['Транспорт XHTTP','network'],vlessens:['Серверный VLESS Encryption','shield'],finalmask:['Маскировка потоков','layers'],hysteria:['Шаблон Hysteria2','radio'],uuid:['Скопировать UUID','fingerprint'],backup:['Экспорт текущего JSON','download'],inbound:['Добавить серверный inbound','plus']};
const featured=['reality','shortid','vlessens','vision','xhttp','dns','routing','inbound'];
const icons={
 reality:'<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="m9 12 2 2 4-4"/>',
 shortid:'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',
 vlessens:'<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="M8 12h8M12 8v8"/>',
 vision:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
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
// Reality is a configuration action, never an implicit key-rotation button.
// Server-only fields are changed only after the user reviews the full form.
const realityTarget=value=>{
 const match=String(value||'').trim().match(/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})$/i);
 if(!match||Number(match[2])<1||Number(match[2])>65535||match[1].includes('..')||match[1].startsWith('.')||match[1].endsWith('.'))return null;
 return {host:match[1],port:Number(match[2])};
};
const realityList=value=>String(value||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).map(x=>x==='""'?'':x);
const realityListText=values=>Array.isArray(values)?values.map(x=>x===''?'""':String(x)).join(', '):'';
const checkRealityForm=values=>{
 const parsed=realityTarget(values.target);
 if(!parsed)return 'Укажите Reality target в формате домен:порт (например, example.com:443).';
 const sni=realityList(values.serverNames);
 const defaultSni=parsed.host.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(parsed.host)?'':parsed.host;
 const names=sni.length?sni:(defaultSni?[defaultSni]:[]);
 if(!names.length)return 'Для IP-адреса target укажите допустимые SNI вручную.';
 if(names.length>32||names.some(n=>n!==''&&(!/^[a-z0-9.-]+$/i.test(n)||n.includes('..')||n.startsWith('.')||n.endsWith('.'))))return 'SNI должны быть доменами без * и пробелов, максимум 32.';
 if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)return 'Уберите повторяющиеся SNI.';
 const ids=realityList(values.shortIds);
 if(ids.length>64)return 'Допускается не более 64 Short ID.';
 if(ids.some(id=>!shortIdValid(id)))return 'Short ID: от 0 до 16 шестнадцатеричных символов, чётная длина. Для пустого используйте "".';
 if(new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)return 'Уберите повторяющиеся Short ID.';
 return '';
};
async function setReality(){
 try{
  ensureDialogs();
  const selected=await chooseInbound();
  if(!selected)return;
  if(area.value!==selected.source){notify('JSON изменился, повторите настройку Reality.');return}
  const inbound=getInbound(parse(),selected.index);
  const stream=inbound.streamSettings||{},transport=stream.network||'raw';
  if(!['raw','xhttp','grpc'].includes(transport))throw Error('Reality поддерживает RAW, XHTTP и gRPC. Текущий транспорт: '+transport+'.');
  const existing=stream.realitySettings??{};
  if(!existing||typeof existing!=='object'||Array.isArray(existing))throw Error('realitySettings должен быть объектом.');
  const privateKey=typeof existing.privateKey==='string'?existing.privateKey.trim():'';
  const hasKey=Boolean(privateKey&&!/REPLACE|YOUR[_-]?KEY|example/i.test(privateKey));
  const currentTarget=typeof existing.target==='string'?existing.target:typeof existing.dest==='string'?existing.dest:'';
  const options=hasKey?
   [{value:'keep',label:'Сохранить действующий privateKey (рекомендуется)'},{value:'rotate',label:'Сгенерировать новый privateKey (ротация)'}]:
   [{value:'generate',label:'Сгенерировать новую пару X25519'}];
  const response=await dialog.request({
   eyebrow:'XRAY STUDIO / REALITY',
   title:'Настройка REALITY',
   description:'Inbound: '+(inbound.tag||'#'+(selected.index+1))+' · '+String(transport).toUpperCase()+'. Заполните серверные параметры; до подтверждения JSON не изменится.',
   confirmLabel:'Применить к JSON',
   notice:hasKey?'Существующий privateKey будет сохранён, если вы явно не выберете ротацию. Смена ключа потребует обновления клиентских подключений.':'Новая пара X25519 генерируется только после нажатия «Применить к JSON».',
   fields:[
    {name:'target',label:'Reality target · домен:порт',wide:true,required:true,value:currentTarget,
     placeholder:'example.com:443',help:'Сервер назначения для маскировки. Используйте проверенный HTTPS-хост, не пример из подсказки.',
     validate:value=>realityTarget(value)?'':'Введите корректный адрес и порт 1–65535.'},
    {name:'serverNames',label:'Допустимые SNI (через запятую)',wide:true,value:realityListText(existing.serverNames),
     placeholder:'example.com, www.example.com',help:'Если поле пустое, будет использован домен из target. Сохраняются все указанные имена.'},
    {name:'shortIds',label:'Short ID (через запятую)',wide:true,value:realityListText(existing.shortIds),
     placeholder:'Пусто — создать случайный Short ID',help:'Существующие ID сохраняются. Для пустого ID укажите "". Некорректные ID исправьте здесь.'},
    {name:'keyMode',label:'Ключ X25519',type:'select',wide:true,value:hasKey?'keep':'generate',options}
   ],
   validate:checkRealityForm
  });
  if(!response)return;
  const formError=checkRealityForm(response);
  if(formError)throw Error(formError);
  if(area.value!==selected.source){notify('JSON изменился, пока открывалось окно Reality. Повторите действие.');return}
  const parsedTarget=realityTarget(response.target);
  const enteredNames=realityList(response.serverNames);
  const defaultSni=parsedTarget.host.startsWith('[')||/^\d+\.\d+\.\d+\.\d+$/.test(parsedTarget.host)?'':parsedTarget.host;
  const sni=enteredNames.length?enteredNames:[defaultSni];
  const enteredIds=realityList(response.shortIds);
  const shortIds=enteredIds.length?enteredIds:[hex(8)];
  const rekey=response.keyMode==='rotate';
  const generate=response.keyMode==='generate'||rekey;
  if(rekey){
   const approved=await dialog.confirm({
    title:'Заменить ключ REALITY?',
    description:'Клиенты с действующим public key потеряют подключение до обновления подписки.',
    notice:'Существующий privateKey будет заменён только после подтверждения. Отмена оставит JSON без изменений.',
    confirmLabel:'Сгенерировать и заменить',cancelLabel:'Не менять ключ',danger:true
   });
   if(!approved)return;
  }
  if(generate&&typeof realityKeys!=='function')throw Error('Генератор ключей X25519 недоступен.');
  if(area.value!==selected.source){notify('JSON был изменён. Настройка Reality не применена.');return}
  if(generate)status('Генерация X25519…');
  const keys=generate?await realityKeys():null;
  if(generate&&(typeof keys?.privateKey!=='string'||!keys.privateKey||typeof keys?.publicKey!=='string'||!keys.publicKey))throw Error('Генератор X25519 не вернул корректную пару ключей.');
  if(area.value!==selected.source){notify('JSON изменился во время генерации ключей Reality. Повторите действие.');return}
  const applied=mutate(doc=>{
   const updated=getInbound(doc,selected.index);
   if(updated.tag!==selected.tag)throw Error('Выбранный inbound изменился.');
   const ss=updated.streamSettings??={};
   if(!['raw','xhttp','grpc'].includes(ss.network||'raw'))throw Error('Транспорт inbound изменился.');
   const created=ss.realitySettings==null;
   const rs=ss.realitySettings??={};
   if(!rs||typeof rs!=='object'||Array.isArray(rs))throw Error('realitySettings должен быть объектом.');
   ss.security='reality';
   // target and dest are server aliases; do not leave conflicting values.
   if(Object.hasOwn(rs,'dest')&&!Object.hasOwn(rs,'target'))rs.dest=response.target.trim();
   else {rs.target=response.target.trim();if(Object.hasOwn(rs,'dest'))delete rs.dest;}
   if(created&&rs.show===undefined)rs.show=false;
   rs.serverNames=sni;
   rs.shortIds=shortIds;
   if(generate)rs.privateKey=keys.privateKey;
  },generate?'Новая пара Reality X25519 добавлена в черновик':'Параметры Reality применены к черновику');
  if(!applied)return;
  if(generate){
   try{
    await navigator.clipboard.writeText(keys.publicKey);
    notify('Новый Reality public key скопирован. Сохраните профиль и проверьте JSON через Xray-core.');
   }catch{
    await dialog.request({
     title:'Public key для клиентов',description:'Скопируйте ключ вручную. Он соответствует новому серверному privateKey.',
     confirmLabel:'Готово',fields:[{name:'publicKey',label:'Public key',value:keys.publicKey,readonly:true,wide:true,trim:false}]
    });
   }
  }else notify('Reality обновлён без изменения privateKey. Сохраните профиль после проверки Xray-core.');
 }catch(e){status('Ошибка Reality: '+e.message);notify(e.message)}
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
 async find(){
  try{
   ensureDialogs();
   const response=await dialog.request({title:'Поиск в JSON',description:'Найдите нужный параметр в текущей конфигурации.',confirmLabel:'Найти',
     fields:[{name:'query',label:'Текст для поиска',value:'',wide:true,required:true,placeholder:'Например, realitySettings'}]});
   if(!response)return;
   const q=response.query;
   const pos=area.value.toLowerCase().indexOf(q.toLowerCase(),area.selectionEnd);
   const i=pos>=0?pos:area.value.toLowerCase().indexOf(q.toLowerCase());
   if(i>=0){area.focus();area.setSelectionRange(i,i+q.length);status('Найдено: '+q)}
   else status('Совпадений нет');
  }catch(e){notify(e.message)}
 },
 validate(){const button=root.querySelector('[data-action="check"]');if(button){button.click();return}try{const data=parse();const issues=window.XrayJsonIntelligence?.analyze?.(area.value,data)||[];const errors=issues.filter(i=>i.severity==='error');const warn=issues.filter(i=>i.severity==='warning');status(errors.length+' ошибок · '+warn.length+' предупреждений');if(errors[0]){const x=errors[0];area.focus();if(Number.isInteger(x.start))area.setSelectionRange(x.start,x.end||x.start+1)}notify(errors.length?'Найдены ошибки в JSON':'Синтаксис JSON корректен; полная проверка требует Xray-core')}catch(e){status(e.message);notify(e.message)}},
 async reality(){return setReality()},
 async 'repair-shortids'(){
  try{
   const data=parse(),problems=invalidRealityIds(data);
   if(!problems.length){status('Некорректных Short ID нет');return}
   ensureDialogs();
   const ok=await dialog.confirm({title:'Исправление Reality Short ID',
    description:'Обнаружено '+problems.length+' некорректных или повторяющихся ID в '+new Set(problems.map(p=>p.index)).size+' inbound.',
    notice:'Изменятся только повреждённые значения. Клиенты со старыми ID должны будут обновить подключение.',
    confirmLabel:'Исправить Short ID',cancelLabel:'Отмена'});
   if(!ok)return;
   mutate(doc=>{
    for(const index of new Set(problems.map(x=>x.index))){
     const rs=doc.inbounds[index].streamSettings.realitySettings;
     rs.shortIds=replaceBadIds(rs.shortIds);
    }
   },'Некорректные Reality Short ID исправлены');
  }catch(e){status('Ошибка: '+e.message);notify(e.message)}
 },
 async shortid(){
  try{
   ensureDialogs();
   const chosen=await chooseInbound();if(!chosen)return;
   if(area.value!==chosen.source){notify('Конфигурация изменена, повторите операцию.');return}
   const ib=getInbound(parse(),chosen.index);
   if(ib.streamSettings?.security!=='reality')throw Error('Сначала включите Reality для выбранного inbound.');
   const rs=ib.streamSettings.realitySettings;
   if(!rs||typeof rs!=='object'||Array.isArray(rs))throw Error('Отсутствует realitySettings');
   const before=rs.shortIds??[],ids=repairIds(before,true);
   const invalid=Array.isArray(before)&&before.some((v,i)=>v!==ids[i]);
   if(invalid){
    const proceed=await dialog.confirm({title:'Некорректные Short ID',
      description:'В выбранном inbound есть неверные или дублирующиеся Short ID. Сначала исправим их без добавления лишних значений.',
      confirmLabel:'Исправить значения',
      notice:'Клиенты с изменёнными ID должны будут обновить параметры подключения.'});
    if(!proceed)return;
   }
   if(area.value!==chosen.source){notify('Конфигурация изменена, повторите операцию.');return}
   mutate(doc=>{const current=getInbound(doc,chosen.index);if(current.tag!==chosen.tag)throw Error('Выбранный inbound изменился');current.streamSettings.realitySettings.shortIds=ids},invalid?'Некорректные Short ID исправлены':'Новый Reality Short ID добавлен');
  }catch(e){status('Ошибка: '+e.message);notify(e.message)}
 },
 dns(){let existed=false;const ok=mutate(d=>{if(d.dns&&typeof d.dns==='object'){existed=true;return false}d.dns=clone(snippets.dns)},'DNS добавлен');if(existed||ok)focusJsonSection('dns','DNS')},
 routing(){let existed=false;const ok=mutate(d=>{if(d.routing&&typeof d.routing==='object'){existed=true;return false}d.routing=clone(snippets.routing)},'Routing добавлен');if(existed||ok)focusJsonSection('routing','Routing')},
 policy(){mutate(d=>{d.policy??=clone(snippets.policy);d.stats??=clone(snippets.stats)},'Policy и Stats добавлены')},
 outbounds(){mutate(d=>{d.outbounds??=[];const existing=new Set(d.outbounds.map(x=>x.tag));for(const x of snippets.outbounds)if(!existing.has(x.tag))d.outbounds.push(clone(x))},'Outbounds добавлены')},
 log(){mutate(d=>{d.log??=clone(snippets.log)},'Логирование добавлено')},
 async inbound(){
  try{
   ensureDialogs();
   const source=area.value,data=parse();
   const existing=Array.isArray(data.inbounds)?data.inbounds:[];
   let candidate='vless-main',n=2;
   while(existing.some(i=>i.tag===candidate))candidate='vless-'+n++;
   const response=await dialog.request({
    eyebrow:'XRAY STUDIO / INBOUNDS',
    title:'Новое входящее соединение',
    description:'Создайте inbound с понятным именем. После создания его настройки откроются в JSON-редакторе.',
    confirmLabel:'Создать inbound',
    notice:'Безопасный старт: новый inbound прослушивает только 127.0.0.1. Публичный адрес и TLS/Reality настраиваются отдельно. Сохранение профиля не перезапускает Xray.',
    fields:[
     {name:'tag',label:'Тег inbound',wide:true,value:candidate,required:true,maxLength:64,help:'Уникальный идентификатор. Латинские буквы, цифры, точки, дефисы и подчёркивания.',pattern:'[A-Za-z0-9_.-]{1,64}',patternMessage:'Допустимы только A–Z, цифры, _ . -',validate:value=>existing.some(i=>i.tag===value)?'Inbound с таким тегом уже существует':''},
     {name:'protocol',label:'Протокол',type:'select',value:'vless',options:[{value:'vless',label:'VLESS'},{value:'vmess',label:'VMess'},{value:'trojan',label:'Trojan'}]},
     {name:'port',label:'Локальный порт',type:'number',value:'443',required:true,min:1,max:65535,help:'От 1 до 65535'},
     {name:'transport',label:'Транспорт',type:'select',wide:true,value:'raw',options:[{value:'raw',label:'RAW / TCP'},{value:'xhttp',label:'XHTTP'},{value:'ws',label:'WebSocket'},{value:'grpc',label:'gRPC'}]}
    ]
   });
   if(!response)return;
   if(source!==area.value){notify('JSON изменился, пока окно было открыто. Повторите создание inbound.');return}
   const ok=mutate(doc=>{
    doc.inbounds??=[];
    if(!Array.isArray(doc.inbounds))throw Error('inbounds должен быть массивом');
    if(doc.inbounds.some(i=>i.tag===response.tag))throw Error('Тег inbound уже занят');
    const settings=response.protocol==='vless'?{users:[],decryption:'none'}:{users:[]};
    const streamSettings={network:response.transport,security:'none'};
    if(response.transport==='xhttp')streamSettings.xhttpSettings={path:'/xhttp',mode:'auto'};
    if(response.transport==='ws')streamSettings.wsSettings={path:'/ws'};
    if(response.transport==='grpc')streamSettings.grpcSettings={serviceName:'grpc'};
    doc.inbounds.push({tag:response.tag,listen:'127.0.0.1',port:Number(response.port),protocol:response.protocol,settings,streamSettings});
   },'Inbound «'+response.tag+'» создан. Настройте защиту перед публикацией.');
   if(ok){
    const fragment='"tag": '+JSON.stringify(response.tag),pos=area.value.lastIndexOf(fragment);
    if(pos>=0){area.focus();area.setSelectionRange(pos,pos+fragment.length);status('Inbound «'+response.tag+'» создан — настройте защиту в JSON')}
   }
  }catch(e){status('Ошибка: '+e.message);notify(e.message)}
 },
 async xhttp(){
  try{
   const selected=await chooseInbound();if(!selected)return;
   if(area.value!==selected.source){notify('JSON изменился; повторите действие.');return}
   const current=getInbound(parse(),selected.index).streamSettings||{};
   const existing=current.network==='xhttp'&&current.xhttpSettings&&typeof current.xhttpSettings==='object';
   if(existing){focusJsonSection('xhttpSettings','XHTTP');return}
   if(current.network!=='xhttp'&&current.network!=='raw'){
    const allowed=await dialog.confirm({title:'Изменить транспорт?',
      description:'Переключить inbound «'+selected.tag+'» с '+current.network+' на XHTTP? Настройки предыдущего транспорта сохранятся в JSON, но перестанут применяться.',
      confirmLabel:'Переключить на XHTTP'});
    if(!allowed)return;
   }
   if(area.value!==selected.source){notify('JSON изменился; повторите действие.');return}
   const ok=mutate(doc=>{
    const inbound=getInbound(doc,selected.index);if(inbound.tag!==selected.tag)throw Error('Inbound изменился');
    const ss=inbound.streamSettings??={};
    ss.network='xhttp';ss.xhttpSettings??={path:'/xhttp',mode:'auto'};
   },'XHTTP настроен');
   if(ok)focusJsonSection('xhttpSettings','XHTTP');
  }catch(e){status('Ошибка: '+e.message);notify(e.message)}
 },
 async vision(){
  try{
   ensureDialogs();
   const selected=await chooseInbound();if(!selected)return;
   const inbound=getInbound(parse(),selected.index);
   if(inbound.protocol!=='vless')throw Error('XTLS Vision доступен только для VLESS.');
   const active=inbound.settings?.flow==='xtls-rprx-vision';
   const response=await dialog.request({
    title:'XTLS Vision — сервер и подписка',
    description:'Записывает flow в settings.flow выбранного VLESS inbound. Генератор подписок наследует его для клиентского outbound.',
    confirmLabel:'Применить',
    fields:[{name:'flow',label:'Flow (xtls-rprx-vision или none)',value:active?'xtls-rprx-vision':'xtls-rprx-vision',wide:true,required:true,validate:v=>['xtls-rprx-vision','none'].includes(v)?'':'Допустимо xtls-rprx-vision или none'}]
   });
   if(!response)return;
   if(area.value!==selected.source){notify('JSON изменился; повторите настройку Vision.');return}
   mutate(doc=>{
    const ib=getInbound(doc,selected.index);
    if(ib.tag!==selected.tag||ib.protocol!=='vless')throw Error('Выбранный inbound изменился');
    const settings=ib.settings??={clients:[]};
    if(response.flow==='none')delete settings.flow;
    else settings.flow='xtls-rprx-vision';
    // Remove the obsolete studio-only default so settings.flow is the single source of truth.
    if(ib.xmesh)delete ib.xmesh.clientFlow;
    // Existing per-user overrides must not conflict with the inbound default.
    for(const user of [...(Array.isArray(settings.users)?settings.users:[]),...(Array.isArray(settings.clients)?settings.clients:[])])delete user.flow;
   },'XTLS Vision записан в settings.flow и будет передан в подписку');
  }catch(e){notify(e.message)}
 },
 async vlessens(){
  try{
   ensureDialogs();
   const selected=await chooseInbound();if(!selected)return;
   const inbound=getInbound(parse(),selected.index);
   if(inbound.protocol!=='vless')throw Error('VLESS Encryption доступен только для VLESS.');
   if(typeof apiRequest!=='function')throw Error('API генерации ключей недоступен.');
   if(inbound.settings?.decryption&&inbound.settings.decryption!=='none'){
    const proceed=await dialog.confirm({
     title:'Заменить VLESS Encryption?',
     description:'Новая пара ключей отключит существующих клиентов до обновления подписки.',
     confirmLabel:'Сгенерировать новые ключи',cancelLabel:'Отмена',danger:true
    });
    if(!proceed)return;
   }
   if(area.value!==selected.source){notify('JSON изменился. Повторите действие.');return}
   status('Генерация ML-KEM-768 через установленный Xray-core…');
   const result=await apiRequest('/api/v1/core/vlessenc',{method:'POST'});
   const server=result?.mlkem768?.decryption,client=result?.mlkem768?.encryption;
   if(typeof server!=='string'||typeof client!=='string'||!server.startsWith('mlkem768x25519plus.')||!client.startsWith('mlkem768x25519plus.'))
    throw Error('Xray-core не вернул корректную пару ML-KEM-768.');
   if(area.value!==selected.source)throw Error('JSON изменился во время генерации. Ключи не применены.');
   mutate(doc=>{
    const ib=getInbound(doc,selected.index);
    if(ib.tag!==selected.tag||ib.protocol!=='vless')throw Error('Выбранный inbound изменился.');
    (ib.settings??={users:[]}).decryption=server;
    (ib.xmesh??={}).clientEncryption=client;
   },'ML-KEM-768 сгенерирован: серверный и клиентский ключи записаны в JSON');
  }catch(e){status('Ошибка генерации: '+e.message);notify(e.message)}
 },
 async finalmask(){
  try{
   ensureDialogs();
   const selected=await chooseInbound();if(!selected)return;
   const current=getInbound(parse(),selected.index).streamSettings?.finalmask||{};
   const response=await dialog.request({title:'FinalMask',description:'Редактируйте отдельный объект streamSettings.finalmask. Перед применением проверьте поддержку параметров ядром Xray.',
    confirmLabel:'Применить',fields:[{name:'json',label:'FinalMask JSON',type:'textarea',wide:true,rows:8,value:JSON.stringify(current,null,2),required:true,validate:v=>{try{const parsed=JSON.parse(v);return !parsed||typeof parsed!=='object'||Array.isArray(parsed)?'Требуется JSON-объект':''}catch{return 'Некорректный JSON'}}}]});
   if(!response)return;
   if(area.value!==selected.source){notify('Конфигурация изменилась. Повторите действие.');return}
   const value=JSON.parse(response.json);
   mutate(doc=>{const ib=getInbound(doc,selected.index);if(ib.tag!==selected.tag)throw Error('Inbound изменился');ib.streamSettings??={};if(Object.keys(value).length)ib.streamSettings.finalmask=value;else delete ib.streamSettings.finalmask},'FinalMask обновлён');
  }catch(e){notify(e.message)}
 },
 hysteria(){mutate(d=>{d.inbounds??=[];const tag='hysteria-'+(d.inbounds.length+1);if(d.inbounds.some(x=>x.tag===tag))throw Error('Тег уже занят');d.inbounds.push({tag,listen:'127.0.0.1',port:4433,protocol:'hysteria',settings:{version:2,users:[]},streamSettings:{network:'hysteria',security:'tls',hysteriaSettings:{version:2},tlsSettings:{certificates:[]}}});notify('Заполните TLS-сертификаты и пользователей, затем проверьте ядром Xray-core.')},'Черновик Hysteria2 создан')},
 async uuid(){
  const value=freshUUID();
  try{await navigator.clipboard.writeText(value);notify('UUID скопирован')}
  catch{
   if(!dialog?.request){notify('Не удалось скопировать UUID: '+value);return}
   await dialog.request({title:'UUID создан',description:'Скопируйте UUID вручную.',confirmLabel:'Закрыть',fields:[{name:'uuid',label:'UUID',value,wide:true,readonly:true,trim:false}]});
  }
 },
 backup(){const blob=new Blob([area.value],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='xray-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},
  format(){try{commit(JSON.stringify(parse(),null,2),'JSON отформатирован')}catch(e){notify(e.message)}}
};
host.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b&&operations[b.dataset.tool])return Promise.resolve(operations[b.dataset.tool]()).catch(x=>notify(x.message))});
area.addEventListener('input',()=>{snapshot();refreshIssues()});
area.addEventListener('xmesh:reset-history',()=>{undo=[];redo=[];last=area.value;update()});
area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();operations.undo()}if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||e.shiftKey&&e.key.toLowerCase()==='z')){e.preventDefault();operations.redo() }});
update();refreshIssues();
}
return {setup};
})();