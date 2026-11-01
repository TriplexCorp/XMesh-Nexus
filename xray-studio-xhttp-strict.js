'use strict';

// XRAY STUDIO edits server inbounds. Keep the constructor aligned with the
// current Xray-core SplitHTTPConfig and reject client-only knobs in server JSON.
(()=>{
 const MODES=['auto','packet-up','stream-up','stream-one'];
 const OUTER_KEYS=new Set(['host','path','mode','extra']);
 const ADVANCED_KEYS=new Set([
  'headers','xPaddingBytes','xPaddingObfsMode','xPaddingKey','xPaddingHeader','xPaddingPlacement','xPaddingMethod',
  'uplinkHTTPMethod','sessionIDPlacement','sessionIDKey','sessionIDTable','sessionIDLength','seqPlacement','seqKey',
  'uplinkDataPlacement','uplinkDataKey','uplinkChunkSize','noGRPCHeader','noSSEHeader','scMaxEachPostBytes',
  'scMinPostsIntervalMs','scMaxBufferedPosts','scStreamUpServerSecs','serverMaxHeaderBytes','xmux','downloadSettings'
 ]);
 const ALL_KEYS=new Set([...OUTER_KEYS,...ADVANCED_KEYS]);
 const CLIENT_ONLY=new Set(['noGRPCHeader','scMinPostsIntervalMs','xmux','downloadSettings']);
 const SERVER_ONLY=new Set(['noSSEHeader','scMaxBufferedPosts','scStreamUpServerSecs','serverMaxHeaderBytes']);
 const PACKET_ONLY=new Set(['scMaxEachPostBytes','scMinPostsIntervalMs','scMaxBufferedPosts']);
 const STREAM_UP_ONLY=new Set(['scStreamUpServerSecs']);
 const PLACEMENTS=new Set(['path','cookie','header','query']);
 const PADDING_PLACEMENTS=new Set(['cookie','header','query','queryInHeader']);
 const PADDING_METHODS=new Set(['repeat-x','tokenish']);
 const UPLINK_PLACEMENTS=new Set(['auto','body','cookie','header']);
 const XMUX_KEYS=new Set(['maxConcurrency','maxConnections','cMaxReuseTimes','hMaxRequestTimes','hMaxReusableSecs','hKeepAlivePeriod']);
 const URL_SAFE='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const studioRoot=node=>node?.closest?.('#xm-studio-v4')||null;
 const sourceOf=root=>root?.querySelector?.('[data-v="source"]')||root?.querySelector?.('[data-xm="manual"]')||null;
 const setStatus=(root,message)=>{const el=root?.querySelector?.('[data-tool-status]');if(el)el.textContent=String(message||'')};
 function randomValues(view){const api=globalThis.crypto;if(!api?.getRandomValues)throw Error('Криптографический генератор браузера недоступен');return api.getRandomValues(view)}
 function randomInt(min,max){const lo=Math.ceil(min),hi=Math.floor(max),span=hi-lo+1;if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||span<=0)throw Error('Некорректный диапазон генератора');const limit=Math.floor(0x100000000/span)*span,value=new Uint32Array(1);do randomValues(value);while(value[0]>=limit);return lo+(value[0]%span)}
 function randomText(length=56){const bytes=randomValues(new Uint8Array(length));return Array.from(bytes,b=>URL_SAFE[b&63]).join('')}
 const randomPath=()=>'/'+randomText();
 function parseObject(value,label='JSON'){
  if(value&&typeof value==='object'&&!Array.isArray(value))return clone(value);
  if(typeof value!=='string')throw Error(label+' должен быть JSON-объектом');
  let parsed;try{parsed=JSON.parse(value)}catch{throw Error(label+' содержит некорректный JSON')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(label+' должен быть JSON-объектом');return parsed;
 }
 function range(value,{min=0,allowMinusOne=false}={}){
  if(typeof value==='number')return Number.isInteger(value)&&((allowMinusOne&&value===-1)||value>=min);
  if(typeof value!=='string'||!value)return false;if(allowMinusOne&&value==='-1')return true;
  const m=value.match(/^(\d+)(?:-(\d+))?$/);if(!m)return false;const from=Number(m[1]),to=Number(m[2]??m[1]);return from>=min&&to>=from;
 }
 function positiveEnd(value){if(typeof value==='number')return value>0;if(typeof value!=='string')return false;const m=value.match(/^(\d+)(?:-(\d+))?$/);return Boolean(m&&Number(m[2]??m[1])>0)}
 function extraObject(settings){if(settings?.extra==null||settings.extra==='')return {};return parseObject(settings.extra,'xhttpSettings.extra')}
 function effectiveAdvanced(settings){return settings?.extra!=null&&settings.extra!==''?extraObject(settings):settings||{}}
 const unknownKeys=(object,allowed)=>Object.keys(object||{}).filter(key=>!allowed.has(key));
 function validateAdvanced(advanced,mode,role='server'){
  const errors=[];
  for(const key of unknownKeys(advanced,ADVANCED_KEYS))errors.push(`Неизвестный параметр Xray-core: ${key}`);
  const forbidden=role==='client'?SERVER_ONLY:CLIENT_ONLY;
  for(const key of forbidden)if(own(advanced,key))errors.push(`${key} — ${role==='client'?'server-only':'client-only'} параметр и не должен находиться в ${role==='client'?'client outbound':'server inbound'}`);
  if(own(advanced,'headers')){
   if(!advanced.headers||typeof advanced.headers!=='object'||Array.isArray(advanced.headers))errors.push('headers должен быть объектом key → string');
   else for(const [key,value] of Object.entries(advanced.headers)){if(key.toLowerCase()==='host')errors.push('headers не может содержать Host — используйте xhttpSettings.host');if(typeof value!=='string')errors.push(`headers.${key} должен быть строкой`)}
  }
  if(own(advanced,'xPaddingBytes')&&!range(advanced.xPaddingBytes,{min:1}))errors.push('xPaddingBytes: требуется положительное целое или диапазон min-max');
  if(own(advanced,'xPaddingPlacement')&&!PADDING_PLACEMENTS.has(String(advanced.xPaddingPlacement)))errors.push('xPaddingPlacement: допустимы cookie/header/query/queryInHeader');
  if(own(advanced,'xPaddingMethod')&&!PADDING_METHODS.has(String(advanced.xPaddingMethod)))errors.push('xPaddingMethod: допустимы repeat-x/tokenish');
  for(const key of ['sessionIDPlacement','seqPlacement'])if(own(advanced,key)&&!PLACEMENTS.has(String(advanced[key])))errors.push(`${key}: допустимы path/cookie/header/query`);
  if(own(advanced,'sessionIDTable')){if(typeof advanced.sessionIDTable!=='string'||/[\x80-\uffff]/.test(advanced.sessionIDTable))errors.push('sessionIDTable должен быть ASCII-строкой или predefined table');if(!own(advanced,'sessionIDLength'))errors.push('При sessionIDTable требуется sessionIDLength')}
  if(own(advanced,'sessionIDLength')&&!range(advanced.sessionIDLength,{min:1}))errors.push('sessionIDLength: требуется положительное целое или диапазон');
  if(own(advanced,'uplinkHTTPMethod')){const method=String(advanced.uplinkHTTPMethod).toUpperCase();if(!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method))errors.push('uplinkHTTPMethod содержит недопустимые символы HTTP token');if(method==='GET'&&mode!=='packet-up')errors.push('uplinkHTTPMethod=GET допустим только при mode=packet-up')}
  if(own(advanced,'uplinkDataPlacement')){const placement=String(advanced.uplinkDataPlacement);if(!UPLINK_PLACEMENTS.has(placement))errors.push('uplinkDataPlacement: допустимы auto/body/cookie/header');if(['cookie','header'].includes(placement)&&mode!=='packet-up')errors.push(`uplinkDataPlacement=${placement} допустим только при mode=packet-up`)}
  if(own(advanced,'uplinkChunkSize')&&!range(advanced.uplinkChunkSize,{min:1}))errors.push('uplinkChunkSize: требуется положительное целое или диапазон');
  for(const key of PACKET_ONLY)if(own(advanced,key)&&mode!=='packet-up'&&mode!=='auto')errors.push(`${key} относится только к packet-up и не должен присутствовать при mode=${mode}`);
  if(own(advanced,'scMaxEachPostBytes')&&!range(advanced.scMaxEachPostBytes,{min:1}))errors.push('scMaxEachPostBytes должен быть > 0');
  if(own(advanced,'scMinPostsIntervalMs')&&!range(advanced.scMinPostsIntervalMs,{min:0}))errors.push('scMinPostsIntervalMs должен быть неотрицательным');
  if(own(advanced,'scMaxBufferedPosts')&&(!Number.isInteger(advanced.scMaxBufferedPosts)||advanced.scMaxBufferedPosts<1))errors.push('scMaxBufferedPosts должен быть целым числом >= 1');
  if(own(advanced,'scStreamUpServerSecs')&&mode!=='stream-up'&&mode!=='auto')errors.push(`scStreamUpServerSecs относится только к stream-up и не должен присутствовать при mode=${mode}`);
  if(own(advanced,'scStreamUpServerSecs')&&!range(advanced.scStreamUpServerSecs,{min:0,allowMinusOne:true}))errors.push('scStreamUpServerSecs: ожидается -1, число >= 0 или диапазон');
  if(own(advanced,'noGRPCHeader')&&mode==='packet-up')errors.push('noGRPCHeader относится к stream-up/stream-one, а не packet-up');
  if(own(advanced,'serverMaxHeaderBytes')&&(!Number.isInteger(advanced.serverMaxHeaderBytes)||advanced.serverMaxHeaderBytes<0))errors.push('serverMaxHeaderBytes должен быть целым числом >= 0');
  if(own(advanced,'xmux')){const xmux=advanced.xmux;if(!xmux||typeof xmux!=='object'||Array.isArray(xmux))errors.push('xmux должен быть объектом');else{for(const key of unknownKeys(xmux,XMUX_KEYS))errors.push(`Неизвестный параметр xmux: ${key}`);for(const key of ['maxConcurrency','maxConnections','cMaxReuseTimes','hMaxRequestTimes','hMaxReusableSecs'])if(own(xmux,key)&&!range(xmux[key],{min:0}))errors.push(`xmux.${key}: ожидается неотрицательное число или диапазон`);if(own(xmux,'hKeepAlivePeriod')&&(!Number.isInteger(xmux.hKeepAlivePeriod)||xmux.hKeepAlivePeriod< -1))errors.push('xmux.hKeepAlivePeriod должен быть целым >= -1');if(positiveEnd(xmux.maxConcurrency)&&positiveEnd(xmux.maxConnections))errors.push('xmux.maxConnections и xmux.maxConcurrency нельзя задавать одновременно положительными')}}
  if(own(advanced,'downloadSettings')){const d=advanced.downloadSettings;if(!d||typeof d!=='object'||Array.isArray(d))errors.push('downloadSettings должен быть StreamSettings-объектом');else if(String(d.network||d.method||'').toLowerCase()!=='xhttp')errors.push('downloadSettings.network должен быть xhttp')}
  return errors;
 }
 function validateSettings(settings,role='server'){
  const errors=[];if(!settings||typeof settings!=='object'||Array.isArray(settings))return ['xhttpSettings должен быть объектом'];
  for(const key of unknownKeys(settings,ALL_KEYS))errors.push(`Неизвестный параметр Xray-core: ${key}`);
  const mode=String(settings.mode||'auto');if(!MODES.includes(mode))errors.push('mode: допустимы auto, packet-up, stream-up, stream-one');
  if(own(settings,'path')&&(!String(settings.path).startsWith('/')||String(settings.path).includes(' ')))errors.push('path должен начинаться с / и не содержать пробелы');
  if(settings.extra!=null&&settings.extra!==''){
   let extra;try{extra=extraObject(settings)}catch(error){errors.push(error.message);return errors}
   const shadowed=[...ADVANCED_KEYS].filter(key=>own(settings,key));if(shadowed.length)errors.push(`При наличии extra эти top-level поля игнорируются Xray-core: ${shadowed.join(', ')}`);
   errors.push(...validateAdvanced(extra,mode,role));
  }else errors.push(...validateAdvanced(settings,mode,role));
  return [...new Set(errors)];
 }
 function materialize(settings){let extra=extraObject(settings);for(const key of ADVANCED_KEYS){if(!own(extra,key)&&own(settings,key))extra[key]=clone(settings[key]);delete settings[key]}delete settings.h2Params;delete extra.h2Params;return extra}
 function normalizeForMode(settings,mode,role='server'){
  if(!MODES.includes(mode))throw Error('Некорректный XHTTP mode');settings.mode=mode;const extra=materialize(settings);
  if(mode==='packet-up'){for(const key of STREAM_UP_ONLY)delete extra[key];delete extra.noGRPCHeader}
  else if(mode==='stream-up'){for(const key of PACKET_ONLY)delete extra[key]}
  else if(mode==='stream-one'){for(const key of [...PACKET_ONLY,...STREAM_UP_ONLY])delete extra[key]}
  if(mode!=='packet-up'){if(String(extra.uplinkHTTPMethod||'').toUpperCase()==='GET')extra.uplinkHTTPMethod='POST';if(['cookie','header'].includes(String(extra.uplinkDataPlacement||'')))extra.uplinkDataPlacement='auto'}
  const forbidden=role==='client'?SERVER_ONLY:CLIENT_ONLY;for(const key of forbidden)delete extra[key];
  if(Object.keys(extra).length)settings.extra=extra;else delete settings.extra;return settings;
 }
 function generatedProfile(mode,role='server'){
  if(!MODES.includes(mode))throw Error('Некорректный XHTTP mode');
  const from=randomInt(80,180),to=randomInt(700,1200);const extra={xPaddingBytes:`${from}-${Math.max(from,to)}`,xPaddingObfsMode:true,xPaddingPlacement:'queryInHeader',xPaddingMethod:'tokenish'};
  if(mode==='packet-up'){
   const pFrom=randomInt(450000,650000),pTo=randomInt(850000,1000000);extra.scMaxEachPostBytes=`${pFrom}-${pTo}`;
   if(role==='server')extra.scMaxBufferedPosts=randomInt(24,40);else extra.scMinPostsIntervalMs=`${randomInt(12,24)}-${randomInt(35,60)}`;
  }else if(mode==='stream-up'&&role==='server')extra.scStreamUpServerSecs=`${randomInt(20,30)}-${randomInt(55,80)}`;
  return extra;
 }
 function selected(root,doc){const list=Array.isArray(doc?.inbounds)?doc.inbounds:[];const raw=root.querySelector('[data-tool-inbound]')?.value??root.querySelector('[data-field="inboundSelect"]')?.value??'0';const index=Number(raw);if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Некорректно выбран inbound');return {index,tag:list[index]?.tag??null,inbound:list[index]}}
 function ensure(inbound){const stream=inbound.streamSettings??={};stream.network='xhttp';if(!stream.xhttpSettings||typeof stream.xhttpSettings!=='object'||Array.isArray(stream.xhttpSettings))stream.xhttpSettings={};const x=stream.xhttpSettings;if(!x.path)x.path=randomPath();if(!x.mode)x.mode='auto';return x}
 function commit(root,selection,mutator,label){const source=sourceOf(root);let doc;try{doc=JSON.parse(source.value)}catch{throw Error('Исправьте JSON перед настройкой XHTTP')}const inbound=doc.inbounds?.[selection.index];if(!inbound||inbound.tag!==selection.tag)throw Error('Inbound изменился. Откройте XHTTP заново.');mutator(inbound,doc);const errors=validateSettings(inbound.streamSettings.xhttpSettings,'server');if(errors.length)throw Error(errors[0]);source.value=JSON.stringify(doc,null,2);source.dispatchEvent(new Event('input',{bubbles:true}));setStatus(root,label)}
 const option=(value,label,description)=>({value,label,description});
 async function openMenu(root){
  const dialogs=window.XMeshStudioDialogs;if(!dialogs?.request)return setStatus(root,'Диалоговый модуль XRAY STUDIO не загружен');const source=sourceOf(root);if(!source)return;
  let doc;try{doc=JSON.parse(source.value)}catch(error){return setStatus(root,'Исправьте JSON: '+error.message)}
  const selection=selected(root,doc),x=ensure(clone(selection.inbound)),mode=String(x.mode||'auto');
  const choices=[option('mode','Режим XHTTP',`Текущий: ${mode}. Несовместимые и client-only поля будут удалены.`),option('basic','Path / Host','Основные server inbound параметры.'),option('generate','Сгенерировать чистый server profile','Только server-relevant поля для выбранного mode.'),option('padding','Padding','xPaddingBytes и документированные параметры padding.')];
  if(mode==='packet-up'||mode==='auto')choices.push(option('packet','PACKET-UP · server','scMaxEachPostBytes + scMaxBufferedPosts. Без client-only scMinPostsIntervalMs.'));
  if(mode==='stream-up'||mode==='auto')choices.push(option('stream','STREAM-UP · server','Только scStreamUpServerSecs.'));
  choices.push(option('server','Server response / limits','noSSEHeader и serverMaxHeaderBytes.'),option('advanced','Строгий server JSON','Неизвестные, client-only и mode-incompatible поля блокируются.'));
  const action=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · server inbound',description:'Схема отделяет server-настройки от client-only параметров и следует Xray-core.',confirmLabel:'Открыть',selectFirst:false,fields:[{name:'action',label:'Раздел',type:'cards',wide:true,options:choices}]});if(!action)return;
  if(action.action==='mode'){
   const r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Режим XHTTP',description:'При смене режима удаляются несовместимые и client-only параметры.',confirmLabel:'Применить',fields:[{name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;commit(root,selection,ib=>normalizeForMode(ensure(ib),r.mode,'server'),'XHTTP mode: '+r.mode+' · server schema очищена');return;
  }
  if(action.action==='basic'){
   const r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Path / Host',description:'Host лучше оставлять пустым без необходимости; path должен совпадать у клиента.',confirmLabel:'Применить',fields:[{name:'path',label:'Path',wide:true,value:String(x.path||randomPath()),required:true,validate:v=>String(v).startsWith('/')&&!String(v).includes(' ')?'':'Path должен начинаться с / и не содержать пробелы'},{name:'host',label:'Host · необязательно',wide:true,value:String(x.host||'')}]});if(!r)return;commit(root,selection,ib=>{const s=ensure(ib);s.path=r.path;if(r.host)s.host=r.host;else delete s.host},'XHTTP: Path / Host обновлены');return;
  }
  if(action.action==='generate'){
   const r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Чистый server profile',description:'AUTO остаётся нейтральным. Explicit mode получает только свои server-side tuning поля.',confirmLabel:'Сгенерировать',fields:[{name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;
   const extra=generatedProfile(r.mode,'server');const review=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Проверка server profile',description:'JSON уже проверен по server-role и mode.',confirmLabel:'Применить',fields:[{name:'json',label:'extra',type:'textarea',wide:true,rows:14,value:JSON.stringify(extra,null,2),required:true,validate:v=>{try{return validateAdvanced(parseObject(v,'extra'),r.mode,'server')[0]||''}catch(e){return e.message}}}]});if(!review)return;
   commit(root,selection,ib=>{const s=ensure(ib);s.mode=r.mode;s.extra=parseObject(review.json,'extra');normalizeForMode(s,r.mode,'server')},'XHTTP: чистый server '+r.mode+' профиль применён');return;
  }
  if(action.action==='padding'){
   const a=effectiveAdvanced(x),r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Padding',description:'Padding проверяется и клиентом, и сервером.',confirmLabel:'Применить',fields:[{name:'bytes',label:'xPaddingBytes',wide:true,value:String(a.xPaddingBytes??'100-1000'),required:true,validate:v=>range(v,{min:1})?'':'Нужно положительное число или диапазон'},{name:'placement',label:'xPaddingPlacement',type:'select',value:String(a.xPaddingPlacement||'queryInHeader'),options:[...PADDING_PLACEMENTS].map(v=>({value:v,label:v}))},{name:'method',label:'xPaddingMethod',type:'select',value:String(a.xPaddingMethod||'repeat-x'),options:[...PADDING_METHODS].map(v=>({value:v,label:v}))}]});if(!r)return;commit(root,selection,ib=>{const s=ensure(ib),e=materialize(s);e.xPaddingBytes=/^\d+$/.test(r.bytes)?Number(r.bytes):r.bytes;e.xPaddingObfsMode=true;e.xPaddingPlacement=r.placement;e.xPaddingMethod=r.method;s.extra=e},'XHTTP: padding обновлён');return;
  }
  if(action.action==='packet'){
   const a=effectiveAdvanced(x),r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'PACKET-UP · server',description:'scMinPostsIntervalMs здесь отсутствует намеренно: это client-only параметр.',confirmLabel:'Применить',fields:[{name:'bytes',label:'scMaxEachPostBytes',wide:true,value:String(a.scMaxEachPostBytes??'500000-1000000'),required:true,validate:v=>range(v,{min:1})?'':'Требуется значение > 0'},{name:'buffered',label:'scMaxBufferedPosts',type:'number',wide:true,value:String(a.scMaxBufferedPosts??30),min:1,required:true}]});if(!r)return;commit(root,selection,ib=>{const s=ensure(ib),e=materialize(s);e.scMaxEachPostBytes=/^\d+$/.test(r.bytes)?Number(r.bytes):r.bytes;e.scMaxBufferedPosts=Number(r.buffered);delete e.scMinPostsIntervalMs;s.extra=e},'XHTTP: packet-up server tuning обновлён');return;
  }
  if(action.action==='stream'){
   const a=effectiveAdvanced(x),r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'STREAM-UP · server',description:'Только серверный keepalive stream-up.',confirmLabel:'Применить',fields:[{name:'secs',label:'scStreamUpServerSecs',wide:true,value:String(a.scStreamUpServerSecs??'20-80'),required:true,validate:v=>range(v,{min:0,allowMinusOne:true})?'':'Ожидается -1, число >= 0 или диапазон'}]});if(!r)return;commit(root,selection,ib=>{const s=ensure(ib),e=materialize(s);e.scStreamUpServerSecs=/^-?\d+$/.test(r.secs)?Number(r.secs):r.secs;s.extra=e},'XHTTP: stream-up server keepalive обновлён');return;
  }
  if(action.action==='server'){
   const a=effectiveAdvanced(x),r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'Server response / limits',description:'Параметры, которые относятся именно к серверной стороне.',confirmLabel:'Применить',fields:[{name:'max',label:'serverMaxHeaderBytes',type:'number',wide:true,value:String(a.serverMaxHeaderBytes??0),min:0,required:true},{name:'sse',label:'noSSEHeader',type:'select',value:String(Boolean(a.noSSEHeader)),options:[{value:'false',label:'false'},{value:'true',label:'true'}]}]});if(!r)return;commit(root,selection,ib=>{const s=ensure(ib),e=materialize(s);if(Number(r.max)>0)e.serverMaxHeaderBytes=Number(r.max);else delete e.serverMaxHeaderBytes;if(r.sse==='true')e.noSSEHeader=true;else delete e.noSSEHeader;s.extra=e},'XHTTP: server limits обновлены');return;
  }
  if(action.action==='advanced'){
   const r=await dialogs.request({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · строгий server JSON',description:'Client-only поля (scMinPostsIntervalMs, noGRPCHeader, xmux, downloadSettings) здесь запрещены.',confirmLabel:'Применить',fields:[{name:'json',label:'xhttpSettings',type:'textarea',wide:true,rows:20,value:JSON.stringify(clone(x),null,2),required:true,validate:v=>{try{return validateSettings(parseObject(v,'xhttpSettings'),'server')[0]||''}catch(e){return e.message}}}]});if(!r)return;const parsed=parseObject(r.json,'xhttpSettings');commit(root,selection,ib=>{ib.streamSettings??={};ib.streamSettings.network='xhttp';ib.streamSettings.xhttpSettings=parsed},'XHTTP: strict server JSON применён');
  }
 }
 document.addEventListener('click',event=>{const button=event.target?.closest?.('#xm-studio-v4 [data-tool="xhttp"]');if(!button)return;const root=studioRoot(button);if(!root)return;event.preventDefault();event.stopImmediatePropagation();Promise.resolve(openMenu(root)).catch(error=>setStatus(root,'XHTTP: '+(error?.message||error)))},true);
 window.XMeshXhttpStrict={validateSettings,validateAdvanced,normalizeForMode,generatedProfile,extraObject,effectiveAdvanced};
})();
