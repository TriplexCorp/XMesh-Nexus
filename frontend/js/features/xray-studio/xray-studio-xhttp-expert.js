'use strict';

// Expert XHTTP server-inbound editor. It is loaded after the strict schema and
// intercepts the XHTTP tool at window-capture phase. Validation and mode cleanup
// remain delegated to XMeshXhttpStrict, while this file exposes documented
// server-side SplitHTTPConfig controls without client-only clutter.
(()=>{
 const MODES=['auto','packet-up','stream-up','stream-one'];
 const PLACEMENTS=['path','cookie','header','query'];
 const UPLINK_PLACEMENTS=['auto','body','cookie','header'];
 const PADDING_PLACEMENTS=['cookie','header','query','queryInHeader'];
 const PADDING_METHODS=['repeat-x','tokenish'];
 const PREDEFINED_TABLES={ALPHABET:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',Alphabet:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',BASE36:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',Base62:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',HEX:'0123456789ABCDEF',alphabet:'abcdefghijklmnopqrstuvwxyz',base36:'0123456789abcdefghijklmnopqrstuvwxyz',hex:'0123456789abcdef',number:'0123456789'};
 const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
 const dialogs=()=>window.XMeshStudioDialogs;
 const strict=()=>window.XMeshXhttpStrict;
 const sourceOf=root=>root?.querySelector?.('[data-v="source"]')||root?.querySelector?.('[data-xm="manual"]')||null;
 const setStatus=(root,text)=>{const el=root?.querySelector?.('[data-tool-status]');if(el)el.textContent=String(text||'')};
 const option=(value,label,description)=>({value,label,description});
 function parseObject(value,label='JSON'){
  if(value&&typeof value==='object'&&!Array.isArray(value))return clone(value);
  let parsed;try{parsed=JSON.parse(String(value||''))}catch{throw Error(label+' содержит некорректный JSON')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(label+' должен быть JSON-объектом');
  return parsed;
 }
 function parseRange(value,{min=0,allowMinusOne=false}={}){
  const raw=String(value??'').trim();
  if(allowMinusOne&&raw==='-1')return -1;
  if(!/^\d+(?:-\d+)?$/.test(raw))throw Error('Ожидается целое число или диапазон min-max');
  const [from,to=from]=raw.split('-').map(Number);if(from<min||to<from)throw Error('Некорректный диапазон');
  return from===to?from:raw;
 }
 function rangeBounds(value){
  if(typeof value==='number')return [value,value];
  const m=String(value||'').match(/^(\d+)(?:-(\d+))?$/);return m?[Number(m[1]),Number(m[2]??m[1])]:null;
 }
 function sessionSpace(table,length){
  const chars=PREDEFINED_TABLES[table]||table,bounds=rangeBounds(length);if(!chars||!bounds)return false;
  const base=BigInt(chars.length);let room=0n;for(let k=bounds[0];k<=bounds[1];k++)room+=base**BigInt(k);
  return room>=2147483648n;
 }
 function selection(root){
  const source=sourceOf(root);if(!source)throw Error('JSON источник XRAY STUDIO не найден');
  let doc;try{doc=JSON.parse(source.value)}catch(error){throw Error('Исправьте JSON: '+error.message)}
  const list=Array.isArray(doc.inbounds)?doc.inbounds:[],raw=root.querySelector('[data-tool-inbound]')?.value??root.querySelector('[data-field="inboundSelect"]')?.value??'0',index=Number(raw);
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.inbounds!=null&&!Array.isArray(doc.inbounds))
   throw Error('Корень JSON должен содержать массив inbounds');
  if(!Number.isInteger(index)||index<0||(list.length&&index>=list.length))throw Error('Некорректно выбран inbound');
  if(!list.length){
   const draft={tag:'vless-xhttp',listen:'127.0.0.1',port:443,protocol:'vless',
    settings:{users:[],decryption:'none'},streamSettings:{network:'xhttp',security:'none',xhttpSettings:{path:'/xhttp',mode:'auto'}}};
   return {source,index:0,tag:draft.tag,inbound:draft,newInbound:true};
  }
  return {source,index,tag:list[index]?.tag??null,inbound:list[index],newInbound:false};
 }
 function ensure(inbound){
  const stream=inbound.streamSettings??={};stream.network='xhttp';
  if(!stream.xhttpSettings||typeof stream.xhttpSettings!=='object'||Array.isArray(stream.xhttpSettings))stream.xhttpSettings={};
  const settings=stream.xhttpSettings;if(!settings.path)settings.path='/';if(!settings.mode)settings.mode='auto';return settings;
 }
 function advanced(settings){
  const api=strict();if(!api)throw Error('Строгая XHTTP-схема не загружена');
  api.normalizeForMode(settings,String(settings.mode||'auto'),'server');
  if(!settings.extra||typeof settings.extra!=='object'||Array.isArray(settings.extra))settings.extra={};
  return settings.extra;
 }
 function snapshot(settings){const copy=clone(settings);strict().normalizeForMode(copy,String(copy.mode||'auto'),'server');return copy.extra&&typeof copy.extra==='object'?copy.extra:{}}
 function setOrDelete(obj,key,value){if(value===''||value==null)delete obj[key];else obj[key]=value}
 function commit(root,sel,mutator,label){
  const source=sourceOf(root);let doc;try{doc=JSON.parse(source.value)}catch{throw Error('Исправьте JSON перед настройкой XHTTP')}
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.inbounds!=null&&!Array.isArray(doc.inbounds))
   throw Error('Некорректная структура inbounds');
  if(sel.newInbound&&(doc.inbounds?.length||0))throw Error('Конфигурация изменилась. Повторите действие.');
  if(sel.newInbound)doc.inbounds=[clone(sel.inbound)];
  const inbound=doc.inbounds?.[sel.index];if(!inbound||inbound.tag!==sel.tag)throw Error('Inbound изменился. Откройте XHTTP заново.');
  mutator(inbound,doc);const settings=ensure(inbound),api=strict();api.normalizeForMode(settings,String(settings.mode||'auto'),'server');
  const errors=api.validateSettings(settings,'server');if(errors.length)throw Error(errors[0]);
  if(sel.newInbound&&doc.outbounds==null)doc.outbounds=[{tag:'direct',protocol:'freedom'}];
  source.value=JSON.stringify(doc,null,2);
  source.dispatchEvent(new Event('input',{bubbles:true}));
  source.dispatchEvent(new Event('change',{bubbles:true}));
  setStatus(root,label+' · JSON изменён — сохраните профиль');
 }
 async function ask(spec){const api=dialogs();if(!api?.request)throw Error('Диалоговый модуль XRAY STUDIO не загружен');return api.request(spec)}
 async function openExpert(root,directAction){
  const sel=selection(root),x=ensure(clone(sel.inbound)),mode=String(x.mode||'auto'),e=snapshot(x);
  if(sel.newInbound||sel.inbound.streamSettings?.network!=='xhttp'){
   const api=dialogs();
   if(!api?.confirm)throw Error('Диалоговый модуль XRAY STUDIO не загружен');
   const confirmed=await api.confirm({
    eyebrow:'XRAY STUDIO / XHTTP',
    title:sel.newInbound?'Создать XHTTP inbound?':'Перевести inbound на XHTTP?',
    description:sel.newInbound
     ?'Для пустой конфигурации будет создан безопасный VLESS/XHTTP inbound на 127.0.0.1. Для внешнего доступа настройте пользователей и адрес отдельно.'
     :'У выбранного inbound изменится транспорт на XHTTP. TLS/REALITY сохранится. Проверьте совместимость подключений.',
    confirmLabel:'Продолжить',
    notice:'Исходный JSON изменится только после подтверждения конкретного параметра.'
   });
   if(!confirmed)return;
  }
  const choices=[
   option('mode','Режим XHTTP','При изменении режима несовместимые поля будут очищены.'),
   option('basic','Путь / HTTP Host','Путь подключения и отдельный заголовок Host.'),
   option('headers','HTTP-заголовки','Дополнительные заголовки, кроме Host.'),
   option('padding','Заполнение / обфускация','Размер заполнения и параметры маскировки трафика.'),
   option('session','Идентификатор сессии','Размещение, ключ, таблица символов и длина ID.'),
   option('sequence','Последовательность','Размещение и ключ для нумерации пакетов.'),
   option('uplink','Исходящий HTTP-запрос','Метод HTTP, размещение данных и размер блока.'),
   option('device','Профили устройств · iOS / Android / ПК','Режим и XMUX для платформ. Меняет только клиентские подписки.'),
   option('generate','Чистый серверный пресет','Генерация проверенного серверного пресета без клиентских полей.')
  ];
  if(mode==='packet-up'||mode==='auto')choices.push(option('packet','PACKET-UP · сервер','Настройка размера POST и буферизации.'));
  if(mode==='stream-up'||mode==='auto')choices.push(option('stream','STREAM-UP · сервер','Настройка времени жизни потока.'));
  choices.push(option('server','Ответ сервера / лимиты','Ограничение размера заголовков и SSE.'),option('advanced','Строгий JSON сервера','Полный SplitHTTPConfig с проверкой совместимости.'));
  const action=directAction==='device'?{action:'device'}:await ask({
   eyebrow:'XRAY STUDIO / XHTTP',
   title:'XHTTP · серверные настройки',
   description:'Выберите раздел. Каждая настройка изменится в JSON только после отдельного подтверждения.',
   confirmLabel:'Открыть',
   selectFirst:false,
   previewLabel:'Текущие параметры сервера',
   previewHint:'Предпросмотр не изменяет JSON. Выберите раздел слева и подтвердите настройки в редакторе.',
   preview:()=>({network:'xhttp',xhttpSettings:x}),
   fields:[{name:'action',label:'Раздел',type:'cards',wide:true,options:choices}]
  });if(!action)return;

  if(action.action==='device'){
   const names=['iOS','Android','Windows','macOS','Linux','Auto'];
   const presets={
    ios:{mode:'packet-up',uplinkHTTPMethod:'POST',scMaxEachPostBytes:'131072-524288',scMinPostsIntervalMs:'10-50',
      xmux:{maxConcurrency:0,maxConnections:'3-6',cMaxReuseTimes:0,hMaxRequestTimes:'100-300',hMaxReusableSecs:'180-600',hKeepAlivePeriod:0}},
    desktop:{mode:'stream-up',uplinkHTTPMethod:'POST',
      xmux:{maxConcurrency:1,maxConnections:0,cMaxReuseTimes:'64-128',hMaxRequestTimes:'600-900',hMaxReusableSecs:'1800-3000',hKeepAlivePeriod:0}},
    neutral:{mode:'auto',uplinkHTTPMethod:'POST'},
   };
   const existing=sel.inbound.xmesh?.xhttpDeviceProfiles||sel.inbound.xhttpDeviceProfiles||{};
   const choice=await ask({eyebrow:'XRAY STUDIO / XHTTP CLIENTS',title:'Профили устройств',description:'Клиентские параметры: отдельные настройки каждой ОС. Данные не попадут в серверный inbound Xray.',confirmLabel:'Настроить',fields:[
    {name:'device',label:'Платформа',type:'select',value:'iOS',options:names.map(v=>({value:v,label:v}))},
    {name:'preset',label:'Профиль',type:'select',value:'custom',options:[
      {value:'custom',label:'Текущие настройки · редактировать'},
      {value:'ios',label:'Мобильный · packet-up'},
      {value:'desktop',label:'Универсальный · stream-up'},
      {value:'neutral',label:'Нейтральный · auto'},
      {value:'inherit',label:'Сбросить · наследовать из XHTTP'}]}
   ]});if(!choice)return;
   if(choice.preset==='inherit'){
    commit(root,sel,ib=>{
      if(ib.xmesh?.xhttpDeviceProfiles)delete ib.xmesh.xhttpDeviceProfiles[choice.device];
      if(ib.xhttpDeviceProfiles)delete ib.xhttpDeviceProfiles[choice.device];
    },'XHTTP: профиль '+choice.device+' сброшен');return;
   }
   const base=choice.preset==='custom'
    ? clone(existing[choice.device]||presets.neutral)
    : clone(presets[choice.preset]);
   const defaults={maxConcurrency:0,maxConnections:0,cMaxReuseTimes:0,hMaxRequestTimes:0,hMaxReusableSecs:0,hKeepAlivePeriod:0};
   const xmux=base.xmux?{...defaults,...base.xmux}:defaults;
   const fields=[
    {name:'mode',label:'Режим XHTTP',type:'select',value:base.mode||'auto',options:MODES.map(v=>({value:v,label:v}))},
    {name:'method',label:'Метод uplink',type:'select',value:base.uplinkHTTPMethod||'POST',options:[{value:'POST',label:'POST'},{value:'GET',label:'GET · packet-up'}]},
    {name:'bytes',label:'Размер одного POST · packet-up',value:String(base.scMaxEachPostBytes??''),placeholder:'131072-524288'},
    {name:'interval',label:'Интервал POST, мс · packet-up',value:String(base.scMinPostsIntervalMs??''),placeholder:'10-50'},
    ...['maxConcurrency','maxConnections','cMaxReuseTimes','hMaxRequestTimes','hMaxReusableSecs','hKeepAlivePeriod'].map(name=>({
      name,label:'XMUX · '+name,value:String(xmux[name]??0),required:true
    }))
   ];
   const create=v=>{
    const out={mode:v.mode,uplinkHTTPMethod:v.method};
    if(v.bytes.trim())out.scMaxEachPostBytes=parseRange(v.bytes,{min:1});
    if(v.interval.trim())out.scMinPostsIntervalMs=parseRange(v.interval,{min:0});
    const m={};
    for(const name of Object.keys(defaults)){
      const raw=String(v[name]??'').trim();
      if(name==='hKeepAlivePeriod'){
        if(!/^-?\d+$/.test(raw)||Number(raw)<-1||!Number.isSafeInteger(Number(raw)))throw Error('XMUX keepalive: -1 или целое число >= 0');
        m[name]=Number(raw);
      }else m[name]=parseRange(raw,{min:0});
    }
    if(Object.values(m).some(val=>val!==0))out.xmux=m;
    const {mode,...advanced}=out;
    const errors=strict().validateAdvanced(advanced,mode,'client');
    if(errors.length)throw Error(errors[0]);
    if(mode!=='packet-up'&&(out.scMaxEachPostBytes!=null||out.scMinPostsIntervalMs!=null))throw Error('POST tuning применим только к packet-up');
    return out;
   };
   const edited=await ask({
    eyebrow:'XRAY STUDIO / XHTTP CLIENTS',
    title:'XHTTP · '+choice.device,
    description:'Профиль сохраняется для выбранной платформы и влияет только на клиентскую подписку, не на серверный Xray.',
    confirmLabel:'Сохранить профиль',
    previewLabel:'Клиентский профиль · JSON',
    previewHint:'Предпросмотр показывает фактические поля, которые будут записаны. Сохраните профиль, затем сохраните JSON в панели.',
    preview:values=>({xmesh:{xhttpDeviceProfiles:{[choice.device]:create(values)}}}),
    fields,
    validate:v=>{try{create(v);return ''}catch(err){return err.message}}
   });if(!edited)return;
   const profile=create(edited);
   commit(root,sel,ib=>{
     ib.xmesh??={};ib.xmesh.xhttpDeviceProfiles??={};
     ib.xmesh.xhttpDeviceProfiles[choice.device]=profile;
     if(ib.xhttpDeviceProfiles)delete ib.xhttpDeviceProfiles[choice.device];
   },'XHTTP: '+choice.device+' · '+profile.mode+' сохранён');
   return;
  }
  if(action.action==='mode'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Режим XHTTP',description:'Изменение режима удалит несовместимые дополнительные параметры.',confirmLabel:'Применить',fields:[{name:'mode',label:'Режим',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;
   commit(root,sel,ib=>strict().normalizeForMode(ensure(ib),r.mode,'server'),'XHTTP mode: '+r.mode);return;
  }
  if(action.action==='basic'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Путь / HTTP Host',description:'Путь может содержать параметры запроса. Заголовок Host задаётся отдельно от остальных HTTP-заголовков.',confirmLabel:'Применить',fields:[{name:'path',label:'Path',wide:true,value:String(x.path||'/'),required:true,validate:v=>String(v).startsWith('/')&&!/\s/.test(v)?'':'Path должен начинаться с / и не содержать пробелы'},{name:'host',label:'Host · необязательно',wide:true,value:String(x.host||'')}]});if(!r)return;
   commit(root,sel,ib=>{const s=ensure(ib);s.path=r.path;setOrDelete(s,'host',r.host)},'XHTTP: path/host обновлены');return;
  }
  if(action.action==='headers'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'HTTP-заголовки',description:'Указывайте только дополнительные заголовки. Host настраивается отдельно.',confirmLabel:'Применить',fields:[{name:'json',label:'headers · JSON object',type:'textarea',wide:true,rows:12,value:JSON.stringify(e.headers||{},null,2),required:true,validate:v=>{try{const obj=parseObject(v,'headers');for(const [k,val] of Object.entries(obj)){if(k.toLowerCase()==='host')return 'Host нельзя помещать в headers';if(typeof val!=='string')return `headers.${k} должен быть строкой`}return ''}catch(err){return err.message}}}]});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib)),obj=parseObject(r.json,'headers');if(Object.keys(obj).length)a.headers=obj;else delete a.headers},'XHTTP: headers обновлены');return;
  }
  if(action.action==='padding'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Заполнение / обфускация',description:'При выключенной обфускации неиспользуемые настройки размещения и ключей удаляются.',confirmLabel:'Применить',fields:[
    {name:'bytes',label:'xPaddingBytes',wide:true,value:String(e.xPaddingBytes??'100-1000'),required:true,validate:v=>{try{parseRange(v,{min:1});return ''}catch(err){return err.message}}},
    {name:'obfs',label:'xPaddingObfsMode',type:'select',value:String(Boolean(e.xPaddingObfsMode)),options:[{value:'false',label:'false · core compatibility behavior'},{value:'true',label:'true · explicit obfuscation controls'}]},
    {name:'placement',label:'xPaddingPlacement',type:'select',value:String(e.xPaddingPlacement||'queryInHeader'),options:PADDING_PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'method',label:'xPaddingMethod',type:'select',value:String(e.xPaddingMethod||'repeat-x'),options:PADDING_METHODS.map(v=>({value:v,label:v}))},
    {name:'key',label:'xPaddingKey · optional',value:String(e.xPaddingKey||''),placeholder:'x_padding'},
    {name:'header',label:'xPaddingHeader · optional',value:String(e.xPaddingHeader||''),placeholder:'X-Padding'}
   ]});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));a.xPaddingBytes=parseRange(r.bytes,{min:1});if(r.obfs==='true'){a.xPaddingObfsMode=true;a.xPaddingPlacement=r.placement;a.xPaddingMethod=r.method;setOrDelete(a,'xPaddingKey',r.key);setOrDelete(a,'xPaddingHeader',r.header)}else{delete a.xPaddingObfsMode;delete a.xPaddingPlacement;delete a.xPaddingMethod;delete a.xPaddingKey;delete a.xPaddingHeader}},'XHTTP: padding/obfuscation обновлены');return;
  }
  if(action.action==='session'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Идентификатор сессии',description:'По умолчанию ID передаётся в пути. Для собственной таблицы символов проверяется достаточность вариантов.',confirmLabel:'Применить',fields:[
    {name:'placement',label:'sessionIDPlacement',type:'select',value:String(e.sessionIDPlacement||'path'),options:PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'key',label:'sessionIDKey · optional',value:String(e.sessionIDKey||''),placeholder:'auto: X-Session / x_session'},
    {name:'table',label:'sessionIDTable · optional',wide:true,value:String(e.sessionIDTable||''),placeholder:'Base62 / hex / custom ASCII alphabet'},
    {name:'length',label:'sessionIDLength · required with table',wide:true,value:String(e.sessionIDLength??''),placeholder:'12-16'}
   ],validate:v=>{if(!v.table&&!v.length)return '';if(!v.table)return 'sessionIDLength без sessionIDTable не используется ядром';if(!v.length)return 'Для sessionIDTable нужен sessionIDLength';try{const parsed=parseRange(v.length,{min:1});if(!/^[\x00-\x7F]+$/.test(v.table))return 'sessionIDTable должен содержать только ASCII';if(!sessionSpace(v.table,parsed))return 'Комбинация sessionIDTable/sessionIDLength слишком мала (< 2.1B вариантов)';return ''}catch(err){return err.message}}});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));a.sessionIDPlacement=r.placement;setOrDelete(a,'sessionIDKey',r.key);if(r.table){a.sessionIDTable=r.table;a.sessionIDLength=parseRange(r.length,{min:1})}else{delete a.sessionIDTable;delete a.sessionIDLength}},'XHTTP: Session ID обновлён');return;
  }
  if(action.action==='sequence'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Размещение последовательности',description:'Номер пакета можно передавать в пути, параметре запроса, заголовке или cookie.',confirmLabel:'Применить',fields:[{name:'placement',label:'seqPlacement',type:'select',wide:true,value:String(e.seqPlacement||'path'),options:PLACEMENTS.map(v=>({value:v,label:v}))},{name:'key',label:'seqKey · optional',wide:true,value:String(e.seqKey||''),placeholder:'auto: X-Seq / x_seq'}]});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));a.seqPlacement=r.placement;setOrDelete(a,'seqKey',r.key)},'XHTTP: sequence placement обновлён');return;
  }
  if(action.action==='uplink'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Исходящий HTTP-запрос',description:'GET и передача данных в заголовках/cookie допустимы только с packet-up. Минимальный блок — 64 байта.',confirmLabel:'Применить',fields:[
    {name:'method',label:'uplinkHTTPMethod',value:String(e.uplinkHTTPMethod||'POST').toUpperCase(),required:true,validate:v=>/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(String(v).toUpperCase())?'':'Некорректный HTTP token'},
    {name:'placement',label:'uplinkDataPlacement',type:'select',value:String(e.uplinkDataPlacement||'body'),options:UPLINK_PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'key',label:'uplinkDataKey · optional',value:String(e.uplinkDataKey||''),placeholder:'auto: X-Data / x_data'},
    {name:'chunk',label:'uplinkChunkSize · optional',value:String(e.uplinkChunkSize??''),placeholder:'3000-4000',validate:v=>{if(!v)return '';try{parseRange(v,{min:64});return ''}catch(err){return 'Минимум 64; '+err.message}}}
   ],validate:v=>{if(String(v.method).toUpperCase()==='GET'&&mode!=='packet-up')return 'uplinkHTTPMethod=GET доступен только в packet-up';if(['cookie','header'].includes(v.placement)&&mode!=='packet-up')return `uplinkDataPlacement=${v.placement} доступен только в packet-up`;return ''}});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));a.uplinkHTTPMethod=String(r.method).toUpperCase();a.uplinkDataPlacement=r.placement;if(r.placement==='body'||r.placement==='auto')delete a.uplinkDataKey;else setOrDelete(a,'uplinkDataKey',r.key);if(r.chunk)a.uplinkChunkSize=parseRange(r.chunk,{min:64});else delete a.uplinkChunkSize},'XHTTP: uplink request обновлён');return;
  }
  if(action.action==='generate'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Чистый серверный пресет',description:'Генератор проверяет совместимость режима и серверных параметров.',confirmLabel:'Сгенерировать',fields:[{name:'mode',label:'Режим',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;
   const preset=strict().generatedProfile(r.mode,'server'),review=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Проверка серверного пресета',description:'Необязательные поля можно удалить. Клиентские параметры не пройдут проверку.',confirmLabel:'Применить',fields:[{name:'json',label:'extra',type:'textarea',wide:true,rows:16,value:JSON.stringify(preset,null,2),required:true,validate:v=>{try{return strict().validateAdvanced(parseObject(v,'extra'),r.mode,'server')[0]||''}catch(err){return err.message}}}]});if(!review)return;
   commit(root,sel,ib=>{const s=ensure(ib);s.mode=r.mode;s.extra=parseObject(review.json,'extra')},'XHTTP: server preset применён');return;
  }
  if(action.action==='packet'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'PACKET-UP · сервер',description:'Серверные настройки размера POST и количества буферизуемых запросов.',confirmLabel:'Применить',fields:[{name:'bytes',label:'scMaxEachPostBytes',wide:true,value:String(e.scMaxEachPostBytes??'1000000'),required:true,validate:v=>{try{parseRange(v,{min:1});return ''}catch(err){return err.message}}},{name:'buffered',label:'scMaxBufferedPosts',type:'number',wide:true,value:String(e.scMaxBufferedPosts??30),min:1,required:true}]});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));a.scMaxEachPostBytes=parseRange(r.bytes,{min:1});a.scMaxBufferedPosts=Number(r.buffered)},'XHTTP: packet-up server tuning обновлён');return;
  }
  if(action.action==='stream'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'STREAM-UP · сервер',description:'Ограничения времени жизни серверного потока.',confirmLabel:'Применить',fields:[{name:'secs',label:'scStreamUpServerSecs',wide:true,value:String(e.scStreamUpServerSecs??'20-80'),required:true,validate:v=>{try{parseRange(v,{min:0,allowMinusOne:true});return ''}catch(err){return err.message}}}]});if(!r)return;
   commit(root,sel,ib=>{advanced(ensure(ib)).scStreamUpServerSecs=parseRange(r.secs,{min:0,allowMinusOne:true})},'XHTTP: stream-up server tuning обновлён');return;
  }
  if(action.action==='server'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Ответ сервера / лимиты',description:'Настройки серверного ответа и ограничений HTTP-заголовков.',confirmLabel:'Применить',fields:[{name:'max',label:'serverMaxHeaderBytes · 0 = core default 8192',type:'number',wide:true,value:String(e.serverMaxHeaderBytes??0),min:0,required:true},{name:'sse',label:'noSSEHeader',type:'select',wide:true,value:String(Boolean(e.noSSEHeader)),options:[{value:'false',label:'false · default SSE header behavior'},{value:'true',label:'true · suppress SSE header'}]}]});if(!r)return;
   commit(root,sel,ib=>{const a=advanced(ensure(ib));if(Number(r.max)>0)a.serverMaxHeaderBytes=Number(r.max);else delete a.serverMaxHeaderBytes;if(r.sse==='true')a.noSSEHeader=true;else delete a.noSSEHeader},'XHTTP: server response/limits обновлены');return;
  }
  if(action.action==='advanced'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · строгий JSON сервера',description:'Полная схема серверных настроек XHTTP. Клиентские параметры XMUX и другие несовместимые поля будут отклонены.',confirmLabel:'Применить',fields:[{name:'json',label:'xhttpSettings',type:'textarea',wide:true,rows:24,value:JSON.stringify(clone(x),null,2),required:true,validate:v=>{try{return strict().validateSettings(parseObject(v,'xhttpSettings'),'server')[0]||''}catch(err){return err.message}}}]});if(!r)return;
   const parsed=parseObject(r.json,'xhttpSettings');commit(root,sel,ib=>{ib.streamSettings??={};ib.streamSettings.network='xhttp';ib.streamSettings.xhttpSettings=parsed},'XHTTP: strict server JSON применён');
  }
 }
 window.addEventListener('click',event=>{
  const button=event.target?.closest?.('#xm-studio-v4 [data-tool="xhttp"], #xm-studio-v4 [data-tool="xhttp-device"]');if(!button)return;
  const root=button.closest('#xm-studio-v4');if(!root)return;
  event.preventDefault();event.stopImmediatePropagation();Promise.resolve(openExpert(root,button.dataset.tool==='xhttp-device'?'device':null)).catch(error=>setStatus(root,'XHTTP: '+(error?.message||error)));
 },true);
})();
