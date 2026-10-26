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
let selectedToolInboundIndex=0,selectedToolInboundTag=null;
async function chooseInbound(){
 const source=area.value,data=parse();
 if(!Array.isArray(data.inbounds)||!data.inbounds.length)throw Error('В конфигурации нет inbound');
 if(data.inbounds.length===1)return {index:0,source,tag:data.inbounds[0].tag};
 // The visible inbound selector controls both the palette and the action target.
 // Preserve the legacy picker only for older embedded callers without a selector.
 if(host.querySelector('[data-tool-inbound]')){
  const index=resolveToolInbound(data.inbounds);
  return {index,source,tag:data.inbounds[index].tag};
 }
 ensureDialogs();
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
 ['reality','REALITY'],['shortid','Short ID'],['vlessens','VLESS Encryption'],['vision','XTLS Vision'],
 ['tls','TLS'],['hysteria-config','Hysteria2'],['protocol-config','Параметры протокола'],['transport-config','Параметры транспорта'],
 ['dns','DNS'],['routing','Routing'],['outbounds','Outbounds'],['inbound','Новый inbound'],
 ['xhttp','XHTTP'],['finalmask','FinalMask']
];
const details={
 reality:'REALITY: target, SNI, Short ID и X25519',shortid:'Сгенерировать Short ID для REALITY',
 vlessens:'Сгенерировать VLESS Encryption',vision:'Добавить XTLS Vision',
 tls:'Редактировать серверные TLS settings', 'hysteria-config':'Настройки транспорта Hysteria2',
 'protocol-config':'Редактировать параметры текущего inbound', 'transport-config':'Настройки транспорта',
 dns:'Открыть или добавить DNS',routing:'Открыть или добавить Routing',
 outbounds:'Добавить базовые outbounds',inbound:'Создать inbound',xhttp:'Открыть или добавить настройки XHTTP',
 finalmask:'Настроить FinalMask'
};
const icons={
 reality:'<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="m9 12 2 2 4-4"/>',
 shortid:'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',
 vlessens:'<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="M8 12h8M12 8v8"/>',
 vision:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 tls:'<path d="M12 2 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6l-8-4Z"/><path d="M8 12h8M12 8v8"/>',
 'hysteria-config':'<path d="M3 12a9 9 0 0 1 18 0"/><path d="M6 12a6 6 0 0 1 12 0"/><path d="M9 12a3 3 0 0 1 6 0"/><path d="M12 12v9"/>',
 'protocol-config':'<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h4"/>',
 'transport-config':'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
 xhttp:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
 dns:'<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
 routing:'<path d="M4 7h14l-3-3m3 3-3 3M20 17H6l3-3m-3 3 3 3"/>',
 outbounds:'<path d="M4 12h13m-4-4 4 4-4 4"/><rect x="2" y="3" width="20" height="18" rx="2"/>',
 inbound:'<path d="M12 3v13m-5-5 5 5 5-5M4 19h16"/>',
 finalmask:'<path d="M3 7h18M3 12h18M3 17h18"/>'
};
const displayProtocol={hysteria:'Hysteria2',hysteria2:'Hysteria2',vless:'VLESS',vmess:'VMess',trojan:'Trojan',shadowsocks:'Shadowsocks',socks:'SOCKS',http:'HTTP'};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeInbounds=data=>Array.isArray(data?.inbounds)?data.inbounds.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{tag:'',protocol:'invalid',streamSettings:{}}):[];
function resolveToolInbound(inbounds){
 if(selectedToolInboundTag!==null){
  const match=inbounds.findIndex(x=>x.tag===selectedToolInboundTag);
  if(match>=0){selectedToolInboundIndex=match;return match}
 }
 selectedToolInboundIndex=Math.min(Math.max(0,selectedToolInboundIndex),inbounds.length-1);
 selectedToolInboundTag=inbounds[selectedToolInboundIndex]?.tag??null;
 return selectedToolInboundIndex;
}
function supportsVision(inbound){
 if(String(inbound?.protocol||'').toLowerCase()!=='vless')return false;
 const network=String(inbound.streamSettings?.network||'tcp').toLowerCase();
 const security=String(inbound.streamSettings?.security||'none').toLowerCase();
 const encryption=String(inbound.settings?.decryption||'').trim();
 const hasEncryption=/^mlkem768x25519plus\.(?:native|xorpub|random)\./i.test(encryption);
 return hasEncryption||(['tcp','raw'].includes(network)&&['tls','reality'].includes(security));
}
function contextualToolGroups(inbound,hasInbound){
 const common=['dns','routing','outbounds','inbound'];
 if(!hasInbound)return [['Конфигурация',common]];
 const protocol=String(inbound.protocol||'').toLowerCase();
 const network=String(inbound.streamSettings?.network||'raw').toLowerCase();
 const security=String(inbound.streamSettings?.security||'none').toLowerCase();
 const hysteria=protocol==='hysteria'||protocol==='hysteria2'||network==='hysteria';
 const specialized=[];
 const networkTools=[];
 if(hysteria){
  specialized.push('hysteria-config','tls','protocol-config');
 }else if(protocol==='vless'){
  if(security==='reality'||security==='none'&&['raw','xhttp','grpc'].includes(network))specialized.push('reality');
  if(security==='reality')specialized.push('shortid');
  if(security==='tls')specialized.push('tls');
  specialized.push('vlessens');
  if(supportsVision(inbound))specialized.push('vision');
 }else{
  // REALITY config is transport-level, not exclusive to VLESS.
  // Shadowsocks + XHTTP + REALITY must remain editable after composition.
  if(security==='reality')specialized.push('reality','shortid');
  else if(['vmess','trojan','shadowsocks'].includes(protocol)&&security==='none'&&['raw','xhttp','grpc'].includes(network))
   specialized.push('reality');
  if(security==='tls')specialized.push('tls');
  specialized.push('protocol-config');
 }
 if(!hysteria){
  const canUseXhttp=['vless','vmess','trojan','shadowsocks'].includes(protocol);
  if(canUseXhttp&&(network==='xhttp'||network==='raw'))networkTools.push('xhttp');
  else if(['ws','grpc','httpupgrade','quic'].includes(network))networkTools.push('transport-config');
 }
 // Expose FinalMask even when the first layer has not been created yet.
 if(['vless','vmess','trojan','shadowsocks','hysteria','hysteria2','masque'].includes(protocol))networkTools.push('finalmask');
 const result=[];
 if(specialized.length)result.push([hysteria?'Hysteria2':displayProtocol[protocol]||'Протокол',specialized]);
 if(networkTools.length)result.push(['Транспорт',networkTools]);
 result.push(['Конфигурация',common]);
 return result;
}
const toolButton=id=>{
 const label=tools.find(x=>x[0]===id)?.[1]||id;
 return '<button type="button" class="sv-toolitem sv-tool-'+id+'" data-tool="'+id+'" title="'+escapeHtml(details[id]||label)+'" aria-label="'+escapeHtml(details[id]||label)+'"><span class="sv-tool-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[id]+'</svg></span><span class="sv-tool-label">'+escapeHtml(label)+'</span></button>';
};
const toolCluster=(label,ids)=>'<div class="xm-tool-cluster"><span class="xm-tool-cluster-label">'+escapeHtml(label)+'</span><div class="xm-tools-grid">'+ids.map(toolButton).join('')+'</div></div>';
let toolPaletteSignature='',lastToolStatus='';
function renderToolPalette(){
 let data=null,valid=true;
 try{if(area.value.length>1024*1024)throw Error('size limit');data=parse()}catch{valid=false}
 const inbounds=valid?safeInbounds(data):[];
 const index=inbounds.length?resolveToolInbound(inbounds):0;
 const inbound=inbounds[index];
 const protocol=String(inbound?.protocol||'').toLowerCase();
 const network=String(inbound?.streamSettings?.network||'raw').toLowerCase();
 const security=String(inbound?.streamSettings?.security||'none').toLowerCase();
 const groups=valid?contextualToolGroups(inbound,!!inbound):[];
 const selection=valid&&inbounds.length>1?inbounds.map((ib,i)=>[i,String(ib.tag||'Inbound '+(i+1)),String(ib.protocol||'').toUpperCase()]):[];
 const signature=JSON.stringify([valid,selection,selectedToolInboundIndex,inbound?.tag,protocol,network,security,groups,inbound?.streamSettings?.finalmask?true:false]);
 if(signature===toolPaletteSignature)return;
 toolPaletteSignature=signature;
 const context=valid?(inbound?
  (displayProtocol[protocol]||String(inbound.protocol||'Протокол').toUpperCase())+' · '+network.toUpperCase()+' · '+security.toUpperCase():
  'Нет inbound — создайте входящее соединение'):'Исправьте JSON для работы с инструментами';
 const selector=selection.length?'<label class="xm-tool-inbound"><span>Входящее соединение</span><select data-tool-inbound aria-label="Выберите inbound для инструментов">'+selection.map(([i,tag,proto])=>'<option value="'+i+'"'+(i===index?' selected':'')+'>'+escapeHtml(tag+' · '+proto)+'</option>').join('')+'</select></label>':'';
 const currentTag=valid&&inbound&&!selection.length?'<span class="xm-tools-current-tag" title="Текущий inbound">'+escapeHtml(inbound.tag||'Inbound')+'</span>':'';
 host.innerHTML='<div class="xm-tools-header"><div class="xm-tools-identity"><span class="xm-tools-eyebrow">КОНТЕКСТНЫЕ ИНСТРУМЕНТЫ</span><strong class="xm-tools-summary">'+escapeHtml(context)+'</strong></div>'+selector+currentTag+'</div>'+
 (valid?'<div class="xm-tools-groups" role="toolbar" aria-label="Инструменты текущего профиля">'+groups.map(([label,ids])=>toolCluster(label,ids)).join('')+'</div>':'<p class="xm-tools-invalid">Инструменты временно недоступны: исправьте JSON, затем они появятся автоматически.</p>')+
 '<div class="sv-tool-issue" data-tool-issue hidden><span data-tool-issue-message></span><button type="button" data-tool="repair-shortids">Исправить Short ID</button></div><span data-tool-status class="xm-tools-status" role="status" aria-live="polite"></span>';
 const node=host.querySelector('[data-tool-status]');
 if(node)node.textContent=lastToolStatus;
 renderToolPalette();update();refreshIssues();
}

const status=msg=>{lastToolStatus=String(msg||'');const e=host.querySelector('[data-tool-status]');if(e)e.textContent=lastToolStatus};
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
// Require canonical 32-byte X25519 base64url, never a browser password or arbitrary hex token.
const validRealityX25519Key=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(key);
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
  const hasKey=validRealityX25519Key(privateKey);
  const invalidExistingKey=Boolean(privateKey&&!hasKey);
  const originalIds=existing.shortIds??[];
  const previewIds=repairIds(originalIds,false);
  const repairedIds=JSON.stringify(originalIds)!==JSON.stringify(previewIds);
  const currentTarget=typeof existing.target==='string'?existing.target:typeof existing.dest==='string'?existing.dest:'';
  const options=hasKey?
   [{value:'keep',label:'Сохранить действующий privateKey (рекомендуется)'},{value:'rotate',label:'Сгенерировать новый privateKey (ротация)'}]:
   [{value:'generate',label:'Сгенерировать новую пару X25519'}];
  const response=await dialog.request({
   eyebrow:'XRAY STUDIO / REALITY',
   title:'Настройка REALITY',
   description:'Inbound: '+(inbound.tag||'#'+(selected.index+1))+' · '+String(transport).toUpperCase()+'. Заполните серверные параметры; до подтверждения JSON не изменится.',
   confirmLabel:'Применить к JSON',
   notice:invalidExistingKey?'Обнаружен некорректный privateKey — не X25519 base64url (43 символа). Возможно, в JSON попал пароль или токен администратора из автозаполнения браузера. Нужна новая пара ключей. Перед заменой будет отдельное подтверждение.':hasKey?'Действующий X25519 privateKey останется без изменений, если вы явно не выберете ротацию.':(repairedIds?'Некорректные Short ID заменены на HEX в предпросмотре. JSON изменится только после подтверждения.':'Новая пара X25519 будет создана после нажатия «Применить к JSON».'),

   fields:[
    {name:'target',label:'Reality target · домен:порт',wide:true,required:true,value:currentTarget,
     placeholder:'example.com:443',help:'Сервер назначения для маскировки. Используйте проверенный HTTPS-хост, не пример из подсказки.',
     validate:value=>realityTarget(value)?'':'Введите корректный адрес и порт 1–65535.'},
    {name:'serverNames',label:'Допустимые SNI (через запятую)',wide:true,value:realityListText(existing.serverNames),
     placeholder:'example.com, www.example.com',help:'Если поле пустое, будет использован домен из target. Сохраняются все указанные имена.'},
    {name:'shortIds',label:'Short ID (через запятую)',wide:true,value:realityListText(previewIds),
     placeholder:'Пусто — создать случайный Short ID',help:repairedIds?'Предпросмотр: неверные или повторяющиеся Short ID заменены на случайные HEX. Изменения ещё не применены.':'Существующие корректные ID сохраняются. Для пустого ID укажите "".'},
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
  if(hasKey&&!generate&&!validRealityX25519Key(privateKey))throw Error('Недопустимый privateKey.');
  if(invalidExistingKey&&!generate)throw Error('Некорректный ключ можно только заменить новым X25519.');
  if(rekey||invalidExistingKey){
   const approved=await dialog.confirm({
    title:invalidExistingKey?'Заменить некорректный ключ REALITY?':'Заменить ключ REALITY?',
    description:invalidExistingKey?'В JSON найден не-X25519 privateKey. Он будет заменён корректной парой в base64url. Если это был пароль панели, смените его отдельно.':'Клиенты с действующим public key потеряют подключение до обновления подписки.',
    notice:'Существующий privateKey будет заменён только после подтверждения. Отмена оставит JSON без изменений.',
    confirmLabel:'Сгенерировать и заменить',cancelLabel:'Не менять ключ',danger:true
   });
   if(!approved)return;
  }
  if(generate&&typeof realityKeys!=='function')throw Error('Генератор ключей X25519 недоступен.');
  if(area.value!==selected.source){notify('JSON был изменён. Настройка Reality не применена.');return}
  if(generate)status('Генерация X25519…');
  const keys=generate?await realityKeys():null;
  if(generate&&(!validRealityX25519Key(keys?.privateKey)||!validRealityX25519Key(keys?.publicKey)))throw Error('Генератор X25519 не вернул пару base64url длиной 43 символа. Ничего не записано.');
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
   if(!validRealityX25519Key(rs.privateKey))throw Error('Некорректный privateKey. Сгенерируйте новый X25519.');
  },generate?'Новая пара Reality X25519 добавлена в черновик':'Параметры Reality применены к черновику');
  if(!applied)return;
  if(generate){
   try{
    await navigator.clipboard.writeText(keys.publicKey);
    notify('X25519 privateKey (base64url, 43 символа) записан в серверный JSON. Public key скопирован. Проверьте конфигурацию через Xray-core.');
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
// Section editing is scoped to the selected inbound; other server fields stay intact.
async function editInboundJsonSection({name,label,parent='streamSettings',guard,initial={}}){
 ensureDialogs();
 const selection=await chooseInbound();if(!selection)return;
 if(area.value!==selection.source){notify('JSON изменился; повторите действие.');return}
 const inbound=getInbound(parse(),selection.index);
 if(guard)guard(inbound);
 const holder=parent==='streamSettings'?inbound.streamSettings:inbound;
 const existing=holder?.[name];
 if(existing!=null&&(!existing||typeof existing!=='object'||Array.isArray(existing)))throw Error(label+': ожидается JSON-объект.');
 const response=await dialog.request({
  eyebrow:'XRAY STUDIO / '+label.toUpperCase(),title:label,
  description:'Inbound: '+String(inbound.tag||selection.index+1)+'. Изменяется только '+(parent==='streamSettings'?'streamSettings.':'')+name+'. Остальные параметры сохраняются.',
  confirmLabel:'Применить к JSON',
  notice:'После изменения проверьте конфигурацию через установленный Xray-core.',
  fields:[{name:'json',label:'Параметры '+name,type:'textarea',rows:12,wide:true,required:true,value:JSON.stringify(existing??initial,null,2),
   validate:text=>{try{if(text.length>96*1024)return 'Максимум 96 КБ.';const obj=JSON.parse(text);return obj&&typeof obj==='object'&&!Array.isArray(obj)?'':'Требуется JSON-объект'}catch{return 'Некорректный JSON'}}}]
 });
 if(!response)return;
 if(area.value!==selection.source){notify('JSON изменился во время редактирования — операция отменена.');return}
 if(String(response.json).length>96*1024)throw Error('Раздел слишком большой (максимум 96 КБ).');
 let parsed;try{parsed=JSON.parse(response.json)}catch{throw Error('Параметры '+name+': синтаксическая ошибка JSON.')}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error(label+': требуется JSON-объект');
 const changed=mutate(doc=>{
  const ib=getInbound(doc,selection.index);
  if(ib.tag!==selection.tag)throw Error('Выбранный inbound изменился.');
  if(guard)guard(ib);
  const target=parent==='streamSettings'?(ib.streamSettings??={}):ib;
  target[name]=parsed;
  if(name==='tlsSettings'&&['hysteria','hysteria2'].includes(String(ib.protocol||'').toLowerCase())&&target===ib.streamSettings&&ib.streamSettings.security!=='tls')ib.streamSettings.security='tls';
  if(name==='hysteriaSettings'&&parsed.version!=null){
   if(parsed.version!==2)throw Error('Для Hysteria2 требуется version: 2.');
   if(ib.settings&&typeof ib.settings==='object')ib.settings.version=2;
  }
 },label+' обновлён в JSON');
 if(changed)focusJsonSection(name,label);
}
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
   const selected=await chooseInbound();if(!selected)return;
   if(area.value!==selected.source){notify('JSON изменился; повторите настройку Vision.');return}
   const inbound=getInbound(parse(),selected.index);
   if(!supportsVision(inbound))throw Error('XTLS Vision требует VLESS Encryption либо TCP + TLS/REALITY.');
   const changed=mutate(doc=>{
    const ib=getInbound(doc,selected.index);
    if(ib.tag!==selected.tag||!supportsVision(ib))throw Error('Inbound изменился или не поддерживает XTLS Vision');
    const settings=ib.settings??={clients:[]};
    settings.flow='xtls-rprx-vision';
    // The inbound is the authoritative source for subscription flow.
    if(ib.xmesh)delete ib.xmesh.clientFlow;
    for(const user of [...(Array.isArray(settings.users)?settings.users:[]),...(Array.isArray(settings.clients)?settings.clients:[])])delete user.flow;
   },'XTLS Vision добавлен в JSON. Сохраните профиль после проверки Xray-core.');
   if(changed)focusJsonSection('flow','XTLS Vision');
  }catch(e){status('Ошибка Vision: '+e.message);notify(e.message)}
 },
 async 'hysteria-config'(){
  try{await editInboundJsonSection({name:'hysteriaSettings',label:'Hysteria2',initial:{version:2},
   guard:ib=>{const p=String(ib.protocol||'').toLowerCase(),n=String(ib.streamSettings?.network||'').toLowerCase();if(!['hysteria','hysteria2'].includes(p)&&n!=='hysteria')throw Error('Выбранный inbound не использует Hysteria2.')}
  })}catch(e){status('Ошибка Hysteria2: '+e.message);notify(e.message)}
 },
 async tls(){
  try{await editInboundJsonSection({name:'tlsSettings',label:'TLS',initial:{certificates:[]},
   guard:ib=>{
    const p=String(ib.protocol||'').toLowerCase();
    if(ib.streamSettings?.security!=='tls'&&!['hysteria','hysteria2'].includes(p))
     throw Error('У выбранного inbound не включён TLS.');
   }
  })}catch(e){status('Ошибка TLS: '+e.message);notify(e.message)}
 },
 async 'protocol-config'(){
  try{await editInboundJsonSection({name:'settings',label:'Параметры протокола',parent:'inbound',initial:{}})}
  catch(e){status('Ошибка протокола: '+e.message);notify(e.message)}
 },
 async 'transport-config'(){
  try{
   const doc=parse(),inbounds=safeInbounds(doc),index=inbounds.length?resolveToolInbound(inbounds):0;
   const network=String(inbounds[index]?.streamSettings?.network||'').toLowerCase();
   const fields={ws:'wsSettings',grpc:'grpcSettings',httpupgrade:'httpupgradeSettings',quic:'quicSettings'};
   const key=fields[network];if(!key)throw Error('Для этого транспорта нет специализированных параметров.');
   await editInboundJsonSection({name:key,label:'Настройки '+network.toUpperCase(),initial:{},
    guard:ib=>{if(String(ib.streamSettings?.network||'').toLowerCase()!==network)throw Error('Транспорт inbound изменился.')}
   });
  }catch(e){status('Ошибка транспорта: '+e.message);notify(e.message)}
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
   const inbound=getInbound(parse(),selected.index);
   const current=inbound.streamSettings?.finalmask||{};
   const client=inbound.xmesh?.clientFinalmask||{};
   // Guided mode: the JSON editor below remains available for expert layers.
   const network=String(inbound.streamSettings?.network||'raw').toLowerCase();
   const alpn=inbound.streamSettings?.tlsSettings?.alpn||[];
   const quic=network==='hysteria'||network==='masque'||(network==='xhttp'&&alpn.includes('h3'));
   const udp=['hysteria','masque','mkcp','kcp'].includes(network)||
     (network==='xhttp'&&alpn.includes('h3'));
   const tcp=!['hysteria','masque','mkcp','kcp'].includes(network);
   const choices=[
    ...(tcp?[
     {value:'sudoku',label:'TCP · Sudoku',description:'Симметричная маска с безопасным общим секретом.'},
     {value:'fragment',label:'TCP · Fragment',description:'Клиентская фрагментация TLS ClientHello.'},
     {value:'tcp-header-custom',label:'TCP · Header Custom',description:'Произвольные заголовки клиента и сервера; редактор JSON.'},
     {value:'xmc',label:'TCP · XMC',description:'Маскировка Minecraft; клиент и версия Xray должны поддерживать.'}
    ]:[]),
    ...(udp?[
     {value:'salamander',label:'UDP · Salamander / Gecko',description:'Симметричная UDP/QUIC маска, общий пароль.'},
     {value:'udp-sudoku',label:'UDP · Sudoku',description:'Симметричная UDP-маска с общим секретом.'},
     {value:'udp-header-custom',label:'UDP · Header Custom',description:'Настраиваемые UDP-заголовки; редактор JSON.'},
     {value:'mkcp-legacy',label:'UDP · mKCP Legacy',description:'Заголовки DNS/DTLS/SRTP/UTP/WeChat/WireGuard.'},
     {value:'noise',label:'UDP · Noise',description:'Клиентский UDP-шум.'},
     {value:'udphop',label:'UDP · UDP Hop',description:'Смена портов; нужны firewall/NAT настройки.'},
     ...(network==='mkcp'||network==='kcp'?[{value:'xdns',label:'UDP · XDNS',description:'Только mKCP, требуется настроенный DNS.'}]:[]),
     {value:'xicmp',label:'UDP · XICMP',description:'ICMP-маскировка; нужны права системы.'},
     {value:'realm',label:'UDP · Realm',description:'Использует настроенную Realm/STUN-инфраструктуру.'}
    ]:[]),
    ...((tcp||udp)?[{value:'filter',label:'Server · Filter',description:'Только серверный фильтр, не экспортируется клиенту.'}]:[]),
    ...(quic?[{value:'quic-params',label:'QUIC · Параметры',description:'Конфигурация QUIC клиента в JSON.'}]:[]),
    {value:'advanced',label:'Расширенный JSON',description:'Все направления, цепочки и нестандартные параметры.'},
    {value:'clear',label:'Сбросить FinalMask',description:'Удалить серверную и клиентскую маски inbound.'}
   ];
   const action=await dialog.request({
    title:'FinalMask · конструктор',description:'Выберите готовую маску. Секрет генерируется криптографически в браузере, совместимые серверные слои автоматически попадают в JSON-подписку.',
    confirmLabel:'Продолжить',selectFirst:false,
    fields:[{name:'action',label:'Выберите тип маски',type:'cards',wide:true,value:tcp?'sudoku':udp?'salamander':'advanced',options:choices}]
   });
   if(!action)return;
   if(area.value!==selected.source){notify('JSON изменился. Повторите действие.');return}
   if(action.action==='clear'){
    const ok=await dialog.confirm({title:'Удалить FinalMask?',description:'Будут удалены серверная и клиентская маски выбранного inbound.',danger:true,confirmLabel:'Удалить'});
    if(!ok)return;
    if(area.value!==selected.source){notify('JSON изменился. Повторите действие.');return}
    mutate(doc=>{
     const ib=getInbound(doc,selected.index);
     if(ib.tag!==selected.tag)throw Error('Inbound изменился');
     if(ib.streamSettings)delete ib.streamSettings.finalmask;
     if(ib.xmesh){delete ib.xmesh.clientFinalmask;if(!Object.keys(ib.xmesh).length)delete ib.xmesh}
    },'FinalMask удалён');
    return;
   }
   if(['fragment','noise'].includes(action.action)){
    const fragment=action.action==='fragment',direction=fragment?'tcp':'udp';
    if(fragment&&!tcp||!fragment&&!udp)throw Error('Маска несовместима с транспортом');
    // Directional layers belong on the client, and cannot silently replace
    // a required symmetric layer already present on the server.
    if(inbound.streamSettings?.finalmask?.[direction]?.length)
     throw Error('На сервере уже есть маски этого направления. Настройте совместную цепочку клиента в расширенном JSON.');
    const ok=await dialog.confirm({
     title:fragment?'TCP · Fragment':'UDP · Noise',
     description:fragment?
      'Будет добавлена только клиентская фрагментация TLS ClientHello с параметрами lengths 3-5 / 6-8 / 10-20, delays 10-20. Поддержка зависит от клиента.':
      'Будет добавлен только клиентский UDP-шум (8–32 случайных байта, задержка 10–20 мс). Это может увеличить расход трафика.',
     confirmLabel:'Добавить клиентскую маску'
    });
    if(!ok)return;
    if(area.value!==selected.source){notify('JSON изменился. Повторите действие.');return}
    const settings=fragment?
     {packets:'tlshello',lengths:['3-5','6-8','10-20'],delays:['10-20'],maxSplit:'3-6'}:
     {reset:'30-60',noise:[{rand:'8-32',delay:'10-20'}]};
    mutate(doc=>{
     const ib=getInbound(doc,selected.index);
     if(ib.tag!==selected.tag)throw Error('Inbound изменился');
     ib.xmesh??={};ib.xmesh.clientFinalmask??={};
     const layers=ib.xmesh.clientFinalmask[direction]??=[];
     const index=layers.findIndex(v=>v?.type===action.action);
     const layer={type:action.action,settings};
     if(index>=0)layers[index]=layer;else layers.push(layer);
     if(layers.length>16)throw Error('FinalMask: максимум 16 слоёв');
     ib.xmesh.clientFinalmask[direction]=layers;
    },'Клиентская FinalMask '+action.action+' добавлена');
    return;
   }
   if(['sudoku','udp-sudoku','salamander'].includes(action.action)){
    const salamander=action.action==='salamander';
    if(salamander&&!udp||action.action==='udp-sudoku'&&!udp||action.action==='sudoku'&&!tcp)throw Error('FinalMask несовместим с выбранным транспортом');
    if(inbound.xmesh?.clientFinalmask&&Object.keys(inbound.xmesh.clientFinalmask).length)
     throw Error('У inbound есть явная клиентская маска. Сначала согласуйте её в расширенном JSON.');
    if(!crypto?.getRandomValues)throw Error('Криптографический генератор недоступен');
    const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
    const secret=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
    const result=await dialog.request({
     title:salamander?'UDP · Salamander / Gecko':action.action==='udp-sudoku'?'UDP · Sudoku':'TCP · Sudoku',
     description:'Секрет сгенерирован безопасным генератором браузера. Слой будет добавлен в серверный JSON и унаследован клиентской JSON-подпиской.',
     confirmLabel:'Создать маску',
     fields:[
      {name:'password',label:'Общий секрет',value:secret,wide:true,required:true},
      ...(salamander&&quic?[{name:'packetSize',label:'Gecko packetSize (необязательно)',value:'',wide:true,placeholder:'512-1200',
       validate:value=>!value||(/^[0-9]{1,5}(?:-[0-9]{1,5})?$/.test(value)&&
        value.split('-').every(v=>Number(v)>0&&Number(v)<=2048)&&
        (!value.includes('-')||Number(value.split('-')[0])<=Number(value.split('-')[1])))?'':'Нужен размер 1–2048 или диапазон min-max'}]:[])
     ]
    });
    if(!result)return;
    if(area.value!==selected.source){notify('JSON изменился. Повторите действие.');return}
    const direction=salamander||action.action==='udp-sudoku'?'udp':'tcp';
    mutate(doc=>{
     const ib=getInbound(doc,selected.index);
     if(ib.tag!==selected.tag)throw Error('Inbound изменился');
     ib.streamSettings??={};ib.streamSettings.finalmask??={};
     const layers=ib.streamSettings.finalmask[direction]??=[];
     const settings={password:result.password};
     if(salamander&&result.packetSize)settings.packetSize=result.packetSize;
     const kind=action.action==='udp-sudoku'?'sudoku':action.action;
      const layer={type:kind,settings},index=layers.findIndex(v=>v?.type===kind);
     if(index>=0)layers[index]=layer;else layers.push(layer);
     if(layers.length>16)throw Error('FinalMask: максимум 16 слоёв');
     ib.streamSettings.finalmask[direction]=layers;
    },'FinalMask '+action.action+' создан; клиентская подписка наследует симметричную маску');
    return;
   }
   if(action.action!=='advanced')throw Error('Неизвестный тип маски');
   const check=value=>{
    try{
     const data=JSON.parse(value);
     if(!data||typeof data!=='object'||Array.isArray(data))return 'Требуется JSON-объект';
     if(Object.keys(data).some(k=>!['tcp','udp','quicParams'].includes(k)))return 'Разрешены tcp, udp, quicParams';
     for(const dir of ['tcp','udp']){
      if(data[dir]!==undefined&&(!Array.isArray(data[dir])||data[dir].length>16))return dir+': нужен массив не более 16 слоёв';
      if(data[dir]?.some(v=>!v||typeof v.type!=='string'||!v.settings||typeof v.settings!=='object'||Array.isArray(v.settings)))return dir+': нужны type и settings';
     }
     return '';
    }catch{return 'Некорректный JSON'}
   };
   const response=await dialog.request({
    title:'FinalMask · сервер и клиент',
    description:recipeHelp||'Автоэкспорт: TCP Sudoku/header-custom; UDP Salamander/Gecko, Sudoku, mkcp-legacy, header-custom. Для направленных масок задайте clientFinalmask отдельно. QUIC-параметры задаются индивидуально.',
    confirmLabel:'Применить',
    fields:[
     {name:'json',label:'Сервер · streamSettings.finalmask',type:'textarea',wide:true,rows:8,
      value:JSON.stringify(advancedServer,null,2),required:true,validate:check},
     {name:'client',label:'Клиент · xmesh.clientFinalmask (JSON подписки)',type:'textarea',wide:true,rows:8,
      value:JSON.stringify(advancedClient,null,2),required:true,validate:check}
    ]
   });
   if(!response)return;
   if(area.value!==selected.source){notify('Конфигурация изменилась. Повторите действие.');return}
   const server=JSON.parse(response.json),outbound=JSON.parse(response.client);
   if(['tcp','udp'].some(dir=>outbound[dir]?.some(layer=>layer.type==='filter')))
    throw Error('filter допустим только на серверном inbound');
   mutate(doc=>{
    const ib=getInbound(doc,selected.index);
    if(ib.tag!==selected.tag)throw Error('Inbound изменился');
    ib.streamSettings??={};
    if(Object.keys(server).length)ib.streamSettings.finalmask=server;
    else delete ib.streamSettings.finalmask;
    if(Object.keys(outbound).length)(ib.xmesh??={}).clientFinalmask=outbound;
    else if(ib.xmesh){delete ib.xmesh.clientFinalmask;if(!Object.keys(ib.xmesh).length)delete ib.xmesh}
   },'Серверная и клиентская FinalMask обновлены');
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
host.addEventListener('change',e=>{
 if(!e.target.matches('[data-tool-inbound]'))return;
 const index=Number(e.target.value);
 const data=parse(),inbounds=safeInbounds(data);
 if(!Number.isInteger(index)||!inbounds[index])return;
 selectedToolInboundIndex=index;selectedToolInboundTag=inbounds[index].tag??null;
 toolPaletteSignature='';renderToolPalette();
});
area.addEventListener('input',()=>{snapshot();renderToolPalette();refreshIssues()});
area.addEventListener('xmesh:reset-history',()=>{undo=[];redo=[];last=area.value;update();renderToolPalette();refreshIssues()});
area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();operations.undo()}if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||e.shiftKey&&e.key.toLowerCase()==='z')){e.preventDefault();operations.redo() }});
renderToolPalette();update();refreshIssues();
return {refresh:renderToolPalette};
}
return {setup};
})();