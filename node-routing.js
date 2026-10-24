/* JSON-first node routing: no lossy visual rule conversion. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=v=>JSON.stringify(v,null,2);
function open({node,profiles,modal,updateNode,apiRequest,notify,afterSave}){
 const profile=profiles?.find(p=>String(p.id)===String(node.profileId));
 let base={};
 try{base=typeof profile?.config==='string'?JSON.parse(profile.config):profile?.config||{}}catch(_){}
 const fallback={
  log:base.log||{loglevel:'warning'},
  dns:base.dns||{servers:['1.1.1.1']},
  routing:base.routing||{domainStrategy:'AsIs',rules:[]},
  outbounds:[]
 };
 const initial=node.routingJson&&typeof node.routingJson==='object'?node.routingJson:fallback;
 let text=format(initial),changed=false;
 modal('<form class="box route-json-workspace" data-route-json-form method="dialog">'+
 '<header class="route-json-head"><div><span class="route-json-kicker">УЗЛЫ / '+esc(node.name||node.id)+'</span>'+
 '<h2>Маршрутизация</h2><p>Нативный Xray JSON. Настройки применяются только к этой ноде.</p></div>'+
 '<button type="button" class="gh sm route-json-close" data-x aria-label="Закрыть окно" title="Закрыть">✕</button>'+
 '</header>'+
 '<div class="route-json-bar"><label><input type="checkbox" data-route-json-enabled '+(node.routingEnabled?'checked':'')+'> Включить маршрутизацию</label>'+
 '<div><button type="button" class="gh sm" data-route-format>Форматировать</button>'+
 '<button type="button" class="gh sm" data-route-copy>Копировать JSON</button></div></div>'+
 '<div class="route-json-editor"><div class="route-json-editor-head"><strong>NODE ROUTING · JSON</strong><span data-route-json-valid>JSON</span></div>'+
 '<textarea data-route-json-text spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="JSON конфигурация маршрутизации"></textarea></div>'+
 '<footer class="route-json-foot"><span data-route-json-status>Log, DNS, routing и outbounds. Системный маршрут статистики сохраняется автоматически.</span>'+
 '<div><button type="button" class="gh" data-route-json-preview>Проверить</button><button type="submit" class="btn" data-route-json-save>Сохранить</button></div></footer>'+
 '</form>','node-routing-modal');
 const form=document.querySelector('#dlg [data-route-json-form]');if(!form)return;
 const editor=form.querySelector('[data-route-json-text]'),status=form.querySelector('[data-route-json-status]');
 const enabled=form.querySelector('[data-route-json-enabled]'),valid=form.querySelector('[data-route-json-valid]');
 editor.value=text;
 function parse(){
  let obj;
  try{obj=JSON.parse(editor.value)}catch(e){throw Error('Ошибка JSON: '+e.message)}
  if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('Ожидается JSON-объект.');
  const keys=Object.keys(obj);
  if(keys.some(k=>!['log','dns','routing','outbounds'].includes(k)))throw Error('Разрешены только log, dns, routing и outbounds. Другие разделы остаются в XRAY STUDIO.');
  if(obj.routing&&(!Array.isArray(obj.routing.rules)))throw Error('routing.rules должен быть массивом.');
  if(obj.outbounds&&!Array.isArray(obj.outbounds))throw Error('outbounds должен быть массивом.');
  return obj;
 }
 function state(){
  try{parse();valid.textContent='JSON корректен';valid.classList.remove('is-invalid')}
  catch(e){valid.textContent='Ошибка JSON';valid.classList.add('is-invalid')}
 }
 async function save(preview){
  const buttons=form.querySelectorAll('[data-route-json-preview],[data-route-json-save]');
  try{
   const raw=parse();
   const geo=JSON.stringify(raw).includes('geosite:')||JSON.stringify(raw).includes('geoip:')||JSON.stringify(raw).includes('ext:');
   const patch={routingEnabled:enabled.checked,routingJson:raw,routingRules:[],routingRelays:[],
     geoBlockAds:false,geoCustomRules:''};
   if(geo&&enabled.checked)patch.geoEnabled=true;
   buttons.forEach(b=>b.disabled=true);
   status.textContent=preview?'Проверяем конфигурацию…':'Проверяем перед сохранением…';
   await apiRequest('/api/v1/nodes/'+encodeURIComponent(node.id)+'/routing/preview',
      {method:'POST',body:JSON.stringify(patch)});
   if(preview){status.textContent='Проверка структуры прошла. Доступность внешних серверов не проверялась.';return}
   await updateNode(patch);Object.assign(node,patch);
   changed=false;
   status.textContent='Сохранено. Нода получит настройки при следующей синхронизации.';
   notify?.('Маршрутизация сохранена');
   afterSave?.();
  }catch(e){status.textContent=e?.message||'Ошибка проверки маршрутизации';valid.textContent='Проверьте настройки';valid.classList.add('is-invalid')}
  finally{buttons.forEach(b=>b.disabled=false)}
 }
 editor.addEventListener('input',()=>{changed=true;state()});
 enabled.addEventListener('change',()=>{changed=true});
 form.addEventListener('submit',e=>{e.preventDefault();void save(false)});
 form.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-route-json-preview')){void save(true);return}
  if(b.hasAttribute('data-route-format')){
   try{
    const original=editor.value;
    const parsed=parse();
    const formatted=format(parsed);
    editor.value=formatted;
    editor.dispatchEvent(new Event('input',{bubbles:true}));
    editor.focus();
    status.textContent=original===formatted?'JSON уже отформатирован.':'JSON отформатирован.';
   }
   catch(e){status.textContent=e.message}return
  }
  if(b.hasAttribute('data-route-copy')){
   try{navigator.clipboard.writeText(editor.value).then(()=>{status.textContent='JSON скопирован.'}).catch(()=>{status.textContent='Не удалось скопировать JSON.'})}
   catch(_){status.textContent='Буфер обмена недоступен.'}
  }
 });
 state();
}
window.XMeshNodeRouting={open};
})();