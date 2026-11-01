'use strict';

// Expert XHTTP server-inbound editor. Loaded after xray-studio-xhttp-strict.js and
// intercepts the XHTTP tool at window capture phase so the historical reduced
// menu cannot run first. Validation and mode cleanup stay delegated to the
// strict SplitHTTPConfig schema module.
(()=>{
 const MODES=['auto','packet-up','stream-up','stream-one'];
 const PLACEMENTS=['path','cookie','header','query'];
 const UPLINK_PLACEMENTS=['auto','body','cookie','header'];
 const PADDING_PLACEMENTS=['cookie','header','query','queryInHeader'];
 const PADDING_METHODS=['repeat-x','tokenish'];
 const PREDEFINED_TABLES={ALPHABET:'ABCDEFGHIJKLMNOPQRSTUVWXYZ',Alphabet:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',BASE36:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',Base62:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',HEX:'0123456789ABCDEF',alphabet:'abcdefghijklmnopqrstuvwxyz',base36:'0123456789abcdefghijklmnopqrstuvwxyz',hex:'0123456789abcdef',number:'0123456789'};
 const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const dialogs=()=>window.XMeshStudioDialogs;
 const strict=()=>window.XMeshXhttpStrict;
 const sourceOf=root=>root?.querySelector?.('[data-v="source"]')||root?.querySelector?.('[data-xm="manual"]')||null;
 const status=(root,text)=>{const el=root?.querySelector?.('[data-tool-status]');if(el)el.textContent=String(text||'')};
 const option=(value,label,description)=>({value,label,description});
 function parseObject(value,label='JSON'){
  if(value&&typeof value==='object'&&!Array.isArray(value))return clone(value);
  let parsed;try{parsed=JSON.parse(String(value||''))}catch{throw Error(label+' содержит некорректный JSON')}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(label+' должен быть JSON-объектом');
  return parsed;
 }
 function parseRange(value,{allowMinusOne=false,min=0}={}){
  const raw=String(value??'').trim();
  if(allowMinusOne&&raw==='-1')return -1;
  if(!/^\d+(?:-\d+)?$/.test(raw))throw Error('Ожидается целое число или диапазон min-max');
  const [a,b=a]=raw.split('-').map(Number);if(a<min||b<a)throw Error('Некорректный диапазон');
  return a===b?a:raw;
 }
 function rangeBounds(value){
  if(typeof value==='number')return [value,value];
  const m=String(value||'').match(/^(\d+)(?:-(\d+))?$/);return m?[Number(m[1]),Number(m[2]??m[1])]:null;
 }
 function sessionSpace(table,length){
  const chars=PREDEFINED_TABLES[table]||table;
  const bounds=rangeBounds(length);if(!chars||!bounds)return false;
  const base=BigInt(chars.length);let room=0n;
  for(let k=bounds[0];k<=bounds[1];k++)room+=base**BigInt(k);
  return room>=2147483648n;
 }
 function current(root){
  const source=sourceOf(root);if(!source)throw Error('JSON источник XRAY STUDIO не найден');
  let doc;try{doc=JSON.parse(source.value)}catch(error){throw Error('Исправьте JSON: '+error.message)}
  const list=Array.isArray(doc.inbounds)?doc.inbounds:[];
  const raw=root.querySelector('[data-tool-inbound]')?.value??root.querySelector('[data-field="inboundSelect"]')?.value??'0';
  const index=Number(raw);if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Некорректно выбран inbound');
  return {source,doc,index,tag:list[index]?.tag??null,inbound:list[index]};
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
 function cleanKey(extra,key,value){if(value===''||value==null)delete extra[key];else extra[key]=value}
 function commit(root,selection,mutator,label){
  const source=sourceOf(root);let doc;try{doc=JSON.parse(source.value)}catch{throw Error('Исправьте JSON перед настройкой XHTTP')}
  const inbound=doc.inbounds?.[selection.index];if(!inbound||inbound.tag!==selection.tag)throw Error('Inbound изменился. Откройте XHTTP заново.');
  mutator(inbound,doc);
  const settings=ensure(inbound),api=strict();api.normalizeForMode(settings,String(settings.mode||'auto'),'server');
  const errors=api.validateSettings(settings,'server');if(errors.length)throw Error(errors[0]);
  source.value=JSON.stringify(doc,null,2);source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));status(root,label);
 }
 function extraSnapshot(settings){
  const copy=clone(settings);strict().normalizeForMode(copy,String(copy.mode||'auto'),'server');return copy.extra&&typeof copy.extra==='object'?copy.extra:{};
 }
 async function ask(spec){const api=dialogs();if(!api?.request)throw Error('Диалоговый модуль XRAY STUDIO не загружен');return api.request(spec)}
 async function openExpert(root){
  const selection=current(root),x=ensure(clone(selection.inbound)),mode=String(x.mode||'auto'),e=extraSnapshot(x);
  const choices=[
   option('mode','Режим XHTTP',`Текущий: ${mode}. auto / packet-up / stream-up / stream-one.`),
   option('basic','Path / Host','Маршрут и отдельный HTTP Host.'),
   option('headers','HTTP headers','Пользовательские заголовки, кроме Host.'),
   option('padding','Padding / obfuscation','Bytes, key, header, placement, method и obfs mode.'),
   option('session','Session ID','Placement, key, table и length.'),
   option('sequence','Sequence','Placement и key для packet sequencing.'),
   option('uplink','Uplink request','HTTP method, data placement/key и chunk size.'),
   option('generate','Чистый server preset','Документированный preset без client-only полей.')
  ];
  if(mode==='packet-up'||mode==='auto')choices.push(option('packet','PACKET-UP · server','scMaxEachPostBytes и scMaxBufferedPosts.'));
  if(mode==='stream-up'||mode==='auto')choices.push(option('stream','STREAM-UP · server','scStreamUpServerSecs.'));
  choices.push(
   option('server','Server response / limits','noSSEHeader и serverMaxHeaderBytes.'),
   option('advanced','Строгий server JSON','Полный SplitHTTPConfig с role/mode validation.')
  );
  const action=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · expert server inbound',description:'Поля соответствуют актуальному SplitHTTPConfig Xray-core. Client-only параметры намеренно не предлагаются.',confirmLabel:'Открыть',selectFirst:false,fields:[{name:'action',label:'Раздел',type:'cards',wide:true,options:choices}]});if(!action)return;
  if(action.action==='mode'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Режим XHTTP',description:'Смена mode удаляет несовместимые tuning-поля.',confirmLabel:'Применить',fields:[{name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;
   commit(root,selection,ib=>strict().normalizeForMode(ensure(ib),r.mode,'server'),'XHTTP mode: '+r.mode);return;
  }
  if(action.action==='basic'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Path / Host',description:'Path может содержать query; Host задаётся отдельно и не должен дублироваться в headers.',confirmLabel:'Применить',fields:[{name:'path',label:'Path',wide:true,value:String(x.path||'/'),required:true,validate:v=>String(v).startsWith('/')&&!/\s/.test(v)?'':'Path должен начинаться с / и не содержать пробелы'},{name:'host',label:'Host · необязательно',wide:true,value:String(x.host||'')}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib);s.path=r.path;cleanKey(s,'host',r.host)},'XHTTP: path/host обновлены');return;
  }
  if(action.action==='headers'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'HTTP headers',description:'Host запрещён ядром внутри headers — используйте отдельное поле Host.',confirmLabel:'Применить',fields:[{name:'json',label:'headers · JSON object',type:'textarea',wide:true,rows:12,value:JSON.stringify(e.headers||{},null,2),required:true,validate:v=>{try{const obj=parseObject(v,'headers');for(const [k,val] of Object.entries(obj)){if(k.toLowerCase()==='host')return 'Host нельзя помещать в headers';if(typeof val!=='string')return `headers.${k} должен быть строкой`}return ''}catch(err){return err.message}}}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s),obj=parseObject(r.json,'headers');if(Object.keys(obj).length)a.headers=obj;else delete a.headers},'XHTTP: headers обновлены');return;
  }
  if(action.action==='padding'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Padding / obfuscation',description:'Все документированные xPadding* параметры server inbound.',confirmLabel:'Применить',fields:[
    {name:'bytes',label:'xPaddingBytes',wide:true,value:String(e.xPaddingBytes??'100-1000'),required:true,validate:v=>{try{parseRange(v,{min:1});return ''}catch(err){return err.message}}},
    {name:'obfs',label:'xPaddingObfsMode',type:'select',value:String(Boolean(e.xPaddingObfsMode)),options:[{value:'false',label:'false · compatibility placement'},{value:'true',label:'true · explicit placement/method'}]},
    {name:'placement',label:'xPaddingPlacement',type:'select',value:String(e.xPaddingPlacement||'queryInHeader'),options:PADDING_PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'method',label:'xPaddingMethod',type:'select',value:String(e.xPaddingMethod||'repeat-x'),options:PADDING_METHODS.map(v=>({value:v,label:v}))},
    {name:'key',label:'xPaddingKey · optional',value:String(e.xPaddingKey||''),placeholder:'x_padding'},
    {name:'header',label:'xPaddingHeader · optional',value:String(e.xPaddingHeader||''),placeholder:'X-Padding'}
   ]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.xPaddingBytes=parseRange(r.bytes,{min:1});if(r.obfs==='true')a.xPaddingObfsMode=true;else delete a.xPaddingObfsMode;a.xPaddingPlacement=r.placement;a.xPaddingMethod=r.method;cleanKey(a,'xPaddingKey',r.key);cleanKey(a,'xPaddingHeader',r.header)},'XHTTP: padding/obfuscation обновлены');return;
  }
  if(action.action==='session'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Session ID',description:'Placement по умолчанию path. Custom table требует достаточное пространство ID — как в Xray-core.',confirmLabel:'Применить',fields:[
    {name:'placement',label:'sessionIDPlacement',type:'select',value:String(e.sessionIDPlacement||'path'),options:PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'key',label:'sessionIDKey · optional',value:String(e.sessionIDKey||''),placeholder:'auto: X-Session / x_session'},
    {name:'table',label:'sessionIDTable · optional',wide:true,value:String(e.sessionIDTable||''),placeholder:'Base62 / hex / custom ASCII alphabet'},
    {name:'length',label:'sessionIDLength · required with table',wide:true,value:String(e.sessionIDLength??''),placeholder:'12-16'}
   ],validate:v=>{if(!v.table&&!v.length)return '';if(!v.table)return 'sessionIDLength без sessionIDTable не используется ядром';if(!v.length)return 'Для sessionIDTable нужен sessionIDLength';try{const parsed=parseRange(v.length,{min:1});if(!/^[\x00-\x7F]+$/.test(v.table))return 'sessionIDTable должен содержать только ASCII';if(!sessionSpace(v.table,parsed))return 'Комбинация sessionIDTable/sessionIDLength слишком мала (< 2.1B вариантов)';return ''}catch(err){return err.message}}});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.sessionIDPlacement=r.placement;cleanKey(a,'sessionIDKey',r.key);if(r.table){a.sessionIDTable=r.table;a.sessionIDLength=parseRange(r.length,{min:1})}else{delete a.sessionIDTable;delete a.sessionIDLength}},'XHTTP: Session ID обновлён');return;
  }
  if(action.action==='sequence'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Sequence placement',description:'Sequence может идти в path, query, header или cookie.',confirmLabel:'Применить',fields:[{name:'placement',label:'seqPlacement',type:'select',wide:true,value:String(e.seqPlacement||'path'),options:PLACEMENTS.map(v=>({value:v,label:v}))},{name:'key',label:'seqKey · optional',wide:true,value:String(e.seqKey||''),placeholder:'auto: X-Seq / x_seq'}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.seqPlacement=r.placement;cleanKey(a,'seqKey',r.key)},'XHTTP: sequence placement обновлён');return;
  }
  if(action.action==='uplink'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Uplink request',description:'GET и header/cookie data placement допустимы ядром только в packet-up.',confirmLabel:'Применить',fields:[
    {name:'method',label:'uplinkHTTPMethod',value:String(e.uplinkHTTPMethod||'POST').toUpperCase(),required:true,validate:v=>/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(String(v).toUpperCase())?'':'Некорректный HTTP token'},
    {name:'placement',label:'uplinkDataPlacement',type:'select',value:String(e.uplinkDataPlacement||'body'),options:UPLINK_PLACEMENTS.map(v=>({value:v,label:v}))},
    {name:'key',label:'uplinkDataKey · optional',value:String(e.uplinkDataKey||''),placeholder:'auto: X-Data / x_data'},
    {name:'chunk',label:'uplinkChunkSize · optional',value:String(e.uplinkChunkSize??''),placeholder:'3000-4000',validate:v=>{if(!v)return '';try{parseRange(v,{min:1});return ''}catch(err){return err.message}}}
   ],validate:v=>{if(String(v.method).toUpperCase()==='GET'&&mode!=='packet-up')return 'uplinkHTTPMethod=GET доступен только в packet-up';if(['cookie','header'].includes(v.placement)&&mode!=='packet-up')return `uplinkDataPlacement=${v.placement} доступен только в packet-up`;return ''}});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.uplinkHTTPMethod=String(r.method).toUpperCase();a.uplinkDataPlacement=r.placement;if(r.placement==='body'||r.placement==='auto')delete a.uplinkDataKey;else cleanKey(a,'uplinkDataKey',r.key);if(r.chunk)a.uplinkChunkSize=parseRange(r.chunk,{min:1});else delete a.uplinkChunkSize},'XHTTP: uplink request обновлён');return;
  }
  if(action.action==='generate'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Чистый server preset',description:'Preset создаётся строгим генератором и затем проходит role/mode validation.',confirmLabel:'Сгенерировать',fields:[{name:'mode',label:'Mode',type:'select',wide:true,value:mode,options:MODES.map(v=>({value:v,label:v}))}]});if(!r)return;
   const preset=strict().generatedProfile(r.mode,'server');const review=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Проверка preset',description:'Можно удалить необязательные поля, но добавить client-only параметры валидатор не позволит.',confirmLabel:'Применить',fields:[{name:'json',label:'extra',type:'textarea',wide:true,rows:16,value:JSON.stringify(preset,null,2),required:true,validate:v=>{try{return strict().validateAdvanced(parseObject(v,'extra'),r.mode,'server')[0]||''}catch(err){return err.message}}}]});if(!review)return;
   commit(root,selection,ib=>{const s=ensure(ib);s.mode=r.mode;s.extra=parseObject(review.json,'extra')},'XHTTP: server preset применён');return;
  }
  if(action.action==='packet'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'PACKET-UP · server',description:'Только server-relevant packet-up knobs.',confirmLabel:'Применить',fields:[{name:'bytes',label:'scMaxEachPostBytes',wide:true,value:String(e.scMaxEachPostBytes??'1000000'),required:true,validate:v=>{try{parseRange(v,{min:1});return ''}catch(err){return err.message}}},{name:'buffered',label:'scMaxBufferedPosts',type:'number',wide:true,value:String(e.scMaxBufferedPosts??30),min:1,required:true}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.scMaxEachPostBytes=parseRange(r.bytes,{min:1});a.scMaxBufferedPosts=Number(r.buffered)},'XHTTP: packet-up server tuning обновлён');return;
  }
  if(action.action==='stream'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'STREAM-UP · server',description:'Server-side lifetime окна stream-up.',confirmLabel:'Применить',fields:[{name:'secs',label:'scStreamUpServerSecs',wide:true,value:String(e.scStreamUpServerSecs??'20-80'),required:true,validate:v=>{try{parseRange(v,{min:0,allowMinusOne:true});return ''}catch(err){return err.message}}}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);a.scStreamUpServerSecs=parseRange(r.secs,{min:0,allowMinusOne:true})},'XHTTP: stream-up server tuning обновлён');return;
  }
  if(action.action==='server'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'Server response / limits',description:'Только параметры серверной стороны SplitHTTPConfig.',confirmLabel:'Применить',fields:[{name:'max',label:'serverMaxHeaderBytes · 0 = core default 8192',type:'number',wide:true,value:String(e.serverMaxHeaderBytes??0),min:0,required:true},{name:'sse',label:'noSSEHeader',type:'select',wide:true,value:String(Boolean(e.noSSEHeader)),options:[{value:'false',label:'false · default SSE header behavior'},{value:'true',label:'true · suppress SSE header'}]}]});if(!r)return;
   commit(root,selection,ib=>{const s=ensure(ib),a=advanced(s);if(Number(r.max)>0)a.serverMaxHeaderBytes=Number(r.max);else delete a.serverMaxHeaderBytes;if(r.sse==='true')a.noSSEHeader=true;else delete a.noSSEHeader},'XHTTP: server response/limits обновлены');return;
  }
  if(action.action==='advanced'){
   const r=await ask({eyebrow:'XRAY STUDIO / XHTTP',title:'XHTTP · strict server JSON',description:'Полная актуальная server-side схема. Client-only поля xmux/downloadSettings/noGRPCHeader/scMinPostsIntervalMs блокируются.',confirmLabel:'Применить',fields:[{name:'json',label:'xhttpSettings',type:'textarea',wide:true,rows:24,value:JSON.stringify(clone(x),null,2),required:true,validate:v=>{try{return strict().validateSettings(parseObject(v,'xhttpSettings'),'server')[0]||''}catch(err){return err.message}}}]});if(!r)return;
   const parsed=parseObject(r.json,'xhttpSettings');commit(root,selection,ib=>{ib.streamSettings??={};ib.streamSettings.network='xhttp';ib.streamSettings.xhttpSettings=parsed},'XHTTP: strict server JSON применён');
  }
 }
 window.addEventListener('click',event=>{
  const button=event.target?.closest?.('#xm-studio-v4 [data-tool="xhttp"]');if(!button)return;
  const root=button.closest('#xm-studio-v4');if(!root)return;
  event.preventDefault();event.stopImmediatePropagation();
  Promise.resolve(openExpert(root)).catch(error=>status(root,'XHTTP: '+(error?.message||error)));
 },true);
})();
