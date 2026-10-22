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
const update=()=>{host.querySelector('[data-tool="undo"]').disabled=undo.length===0;host.querySelector('[data-tool="redo"]').disabled=redo.length===0};
const commit=(value,msg)=>{snapshot();const from=area.value;if(value===from)return;undo.push(from);if(undo.length>80)undo.shift();redo=[];area.value=value;last=value;area.dispatchEvent(new Event('input',{bubbles:true}));area.focus();update();notify(msg||'JSON обновлён')};
const parse=()=>{try{const x=JSON.parse(area.value);if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Корень должен быть объектом');return x}catch(e){throw Error('Исправьте синтаксис JSON перед применением: '+e.message)}};
const getInbound=(data)=>{if(!Array.isArray(data.inbounds)||!data.inbounds.length)throw Error('В конфигурации нет inbound');if(data.inbounds.length===1)return data.inbounds[0];const tags=data.inbounds.map((x,i)=>i+': '+(x.tag||'(без тега)'));const answer=prompt('Выберите inbound по индексу:\n'+tags.join('\n'),'0');if(answer===null)return null;const i=Number(answer);if(!Number.isInteger(i)||i<0||i>=data.inbounds.length)throw Error('Неверный индекс inbound');return data.inbounds[i]};
const mutate=(fn,label)=>{try{const data=parse(),changed=fn(data);if(changed===false)return;commit(JSON.stringify(data,null,2),label)}catch(e){notify(e.message)}};
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
 ['inbound','Новый inbound'],['xhttp','XHTTP настройки'],['format','Форматировать']
];
const details={reality:['Ключи X25519 для Reality','key-round'],shortid:['Генерация Short ID','hash'],dns:['Настройка DNS-серверов','globe'],routing:['Правила маршрутизации','route'],policy:['Политики и статистика','chart-no-axes-column'],outbounds:['Исходящие соединения','network'],validate:['Проверка структуры JSON','shield-check']};
const featured=['reality','shortid','dns','routing','policy','outbounds','validate'];
host.innerHTML='<div class="xm-tools-grid">'+featured.map(id=>{const item=tools.find(x=>x[0]===id),meta=details[id];return '<button type="button" class="sv-toolitem sv-tool-'+id+'" data-tool="'+id+'"><span class="sv-toolicon" aria-hidden="true">'+({reality:'⚿',shortid:'#',dns:'◎',routing:'⇄',policy:'▥',outbounds:'⬡',validate:'✓'}[id])+'</span><span class="sv-toolcopy"><strong>'+item[1].replace(/^[^A-Za-zА-Яа-яЁё0-9]+/,'')+'</strong><small>'+meta[0]+'</small></span><span class="sv-toolarrow">›</span></button>'}).join('')+'</div><div class="sv-secondary-tools"><div class="xm-tools-heading"><strong>Быстрые действия</strong></div>'+tools.filter(([id])=>!featured.includes(id)).map(([id,label])=>'<button type="button" class="xm-quiet" data-tool="'+id+'">'+label+'</button>').join('')+'</div><p data-tool-status class="xm-tools-status" role="status"></p>';
const status=msg=>{const e=host.querySelector('[data-tool-status]');if(e)e.textContent=msg};
const insertAtCursor=(value)=>{const start=area.selectionStart,end=area.selectionEnd;commit(area.value.slice(0,start)+value+area.value.slice(end),'Вставлено в редактор');area.setSelectionRange(start,start+value.length)};
const operations={
 undo(){if(!undo.length)return;redo.push(area.value);const value=undo.pop();area.value=value;last=value;area.dispatchEvent(new Event('input',{bubbles:true}));update()},
 redo(){if(!redo.length)return;undo.push(area.value);area.value=redo.pop();last=area.value;area.dispatchEvent(new Event('input',{bubbles:true}));update()},
 find(){const q=prompt('Найти текст в JSON:');if(!q)return;const pos=area.value.toLowerCase().indexOf(q.toLowerCase(),area.selectionEnd);const i=pos>=0?pos:area.value.toLowerCase().indexOf(q.toLowerCase());if(i>=0){area.focus();area.setSelectionRange(i,i+q.length);status('Найдено: '+q)}else status('Совпадений нет')},
 validate(){try{const data=parse();const issues=window.XrayJsonIntelligence?.analyze?.(area.value,data)||[];const errors=issues.filter(i=>i.severity==='error');const warn=issues.filter(i=>i.severity==='warning');status(errors.length+' ошибок · '+warn.length+' предупреждений');if(errors[0]){const x=errors[0];area.focus();if(Number.isInteger(x.start))area.setSelectionRange(x.start,x.end||x.start+1)}notify(errors.length?'Найдены ошибки в JSON':'Синтаксис JSON корректен; полная проверка требует Xray-core')}catch(e){status(e.message);notify(e.message)}},
 async reality(){try{const keys=await realityKeys();mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;inbound.streamSettings??={};inbound.streamSettings.security='reality';inbound.streamSettings.realitySettings??={show:false,serverNames:[],shortIds:[]};const rs=inbound.streamSettings.realitySettings;if(rs.privateKey&&!confirm('Заменить существующий Reality privateKey у выбранного inbound?'))return false;rs.privateKey=keys.privateKey;status('Ключ вставлен в Reality выбранного inbound. Public key скопируйте для клиента: '+keys.publicKey)},'Reality X25519 обновлён');try{await navigator.clipboard.writeText(keys.publicKey);notify('Reality privateKey применён, publicKey скопирован')}catch{notify('Reality privateKey применён. Public key: '+keys.publicKey)}}catch(e){notify(e.message)}},
 shortid(){mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;inbound.streamSettings??={};inbound.streamSettings.realitySettings??={show:false,serverNames:[]};const a=inbound.streamSettings.realitySettings;a.shortIds??=[];a.shortIds.push(hex(8))},'Short ID добавлен')},
 dns(){mutate(d=>{d.dns??=clone(snippets.dns)},'DNS добавлен')},
 routing(){mutate(d=>{d.routing??=clone(snippets.routing)},'Routing добавлен')},
 policy(){mutate(d=>{d.policy??=clone(snippets.policy);d.stats??=clone(snippets.stats)},'Policy и Stats добавлены')},
 outbounds(){mutate(d=>{d.outbounds??=[];const existing=new Set(d.outbounds.map(x=>x.tag));for(const x of snippets.outbounds)if(!existing.has(x.tag))d.outbounds.push(clone(x))},'Outbounds добавлены')},
 log(){mutate(d=>{d.log??=clone(snippets.log)},'Логирование добавлено')},
 inbound(){mutate(d=>{d.inbounds??=[];const tag=prompt('Тег нового inbound:','new-inbound');if(tag===null)return false;if(!/^[\w.-]{1,64}$/.test(tag)||d.inbounds.some(i=>i.tag===tag))throw Error('Тег пустой, невалидный или уже существует');d.inbounds.push({tag,listen:'0.0.0.0',port:443,protocol:'vless',settings:{clients:[],decryption:'none'},streamSettings:{network:'raw',security:'none'}})},'Новый inbound добавлен')},
 xhttp(){mutate(d=>{const inbound=getInbound(d);if(!inbound)return false;inbound.streamSettings??={};if(inbound.streamSettings.network!=='xhttp'&&inbound.streamSettings.network!=='raw'&&!confirm('Сменить транспорт выбранного inbound на XHTTP?'))return false;inbound.streamSettings.network='xhttp';inbound.streamSettings.xhttpSettings??={path:'/xhttp',mode:'auto'}},'XHTTP добавлен')},
 format(){try{commit(JSON.stringify(parse(),null,2),'JSON отформатирован')}catch(e){notify(e.message)}}
};
host.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b&&operations[b.dataset.tool])Promise.resolve(operations[b.dataset.tool]()).catch(x=>notify(x.message))});
area.addEventListener('input',snapshot);
area.addEventListener('xmesh:reset-history',()=>{undo=[];redo=[];last=area.value;update()});
area.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();operations.undo()}if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||e.shiftKey&&e.key.toLowerCase()==='z')){e.preventDefault();operations.redo() }});
update();
}
return {setup};
})();