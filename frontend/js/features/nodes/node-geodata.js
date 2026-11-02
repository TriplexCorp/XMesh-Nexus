(function(){
'use strict';
const KEYS=['geoEnabled','geoUpdateHours','geoSiteUrl','geoIpUrl','geoExtraSources'];
// Match the server-side signed GeoData manifest defaults. These are actual
// sources, not placeholders; prefill only unset values (including legacy nodes).
const DEFAULT_GEODATA={
 geoSiteUrl:'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
 geoIpUrl:'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat'
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(name,label,value,opts={})=>{
 const id='ng-'+name;
 if(opts.check)return '<label class="geo-toggle"><span><strong>'+label+'</strong><small>'+opts.hint+'</small></span><input type="checkbox" name="'+name+'" '+(value?'checked':'')+'><i aria-hidden="true"></i></label>';
 return '<label class="geo-field" for="'+id+'"><span>'+label+'</span>'+(opts.hint?'<small>'+opts.hint+'</small>':'')+
 (opts.area?'<textarea id="'+id+'" name="'+name+'" spellcheck="false" rows="'+(opts.rows||4)+'" placeholder="'+esc(opts.placeholder||'')+'">'+esc(value)+'</textarea>':
 '<input id="'+id+'" name="'+name+'" '+(opts.number?'type="number" min="6" max="168" step="1"':'type="text"')+' value="'+esc(value)+'" placeholder="'+esc(opts.placeholder||'')+'">')+'</label>';
};
function validate(v){
 if(!v.geoEnabled)return;
 if(!Number.isInteger(v.geoUpdateHours)||v.geoUpdateHours<6||v.geoUpdateHours>168)throw Error('Интервал: от 6 до 168 часов.');
 for(const raw of [v.geoSiteUrl,v.geoIpUrl]){
  if(!raw)continue;
  let u;try{u=new URL(raw)}catch(_){throw Error('Неверный адрес GeoData.')}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw Error('Для GeoData нужны HTTPS-ссылки без учётных данных.');
 }
 const seen=new Set(['geosite.dat','geoip.dat']);
 const sources=v.geoExtraSources.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
 if(sources.length>8)throw Error('Можно добавить не больше 8 файлов.');
 for(const line of sources){
  const parts=line.split(/\s+/);
  if(parts.length<2||parts.length>3||!/^[A-Za-z0-9_-]{1,48}\.dat$/.test(parts[0])||seen.has(parts[0]))throw Error('Дополнительный файл: имя.dat HTTPS_URL [SHA256]. Без повторов.');
  seen.add(parts[0]);
  let u;try{u=new URL(parts[1])}catch(_){throw Error('Некорректная ссылка дополнительного файла.')}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw Error('Дополнительные файлы должны скачиваться по HTTPS.');
  if(parts[2]&&!/^[0-9a-f]{64}$/i.test(parts[2]))throw Error('Неверная SHA-256 контрольная сумма.');
 }
}
function open({node,modal,updateNode,notify,afterSave}){
 const n=node;
 const status=n.geoEnabled?'Настроено':'Выключено';
 const html='<form class="box geo-console" data-geodata-form method="dialog">'+
 '<header class="geo-head"><span class="geo-symbol">◎</span><div><span class="geo-eyebrow">XMesh Nexus / Node services</span><h2>GeoData</h2><p>Скачивание и обновление файлов · '+esc(n.name)+'</p></div><button type="button" class="gh sm geo-close" data-x aria-label="Закрыть">✕</button></header>'+
 '<div class="geo-summary"><div><span>СОСТОЯНИЕ</span><b>'+status+'</b></div><div><span>УЗЕЛ</span><b>'+esc(n.name)+'</b></div><div><span>ОБНОВЛЕНИЕ</span><b>Каждые '+esc(n.geoUpdateHours??24)+' ч</b></div></div>'+
 '<div class="geo-content"><section class="geo-primary"><div class="geo-section-title"><span>01</span><div><h3>Управление</h3><p>Нода обновляет файлы самостоятельно</p></div></div>'+
 field('geoEnabled','Использовать GeoData',!!n.geoEnabled,{check:true,hint:'Подключать GeoSite/GeoIP к Xray на этой ноде'})+
 '<div class="geo-divider"></div>'+field('geoUpdateHours','Интервал проверки, часов',n.geoUpdateHours??24,{number:true,hint:'Автоматически, от 6 до 168 часов'})+
 '<div class="geo-hint">Изменения применяются после синхронизации ноды. Маршруты настраиваются отдельно — кнопка «Маршрутизация» в карточке узла.</div></section>'+
 '<section class="geo-secondary"><div class="geo-section-title"><span>02</span><div><h3>Источники</h3><p>HTTPS-адреса и дополнительные файлы</p></div></div>'+
 field('geoSiteUrl','GeoSite',n.geoSiteUrl||DEFAULT_GEODATA.geoSiteUrl,{placeholder:DEFAULT_GEODATA.geoSiteUrl,hint:'Loyalsoldier · актуальный релиз geosite.dat · можно изменить'})+
 field('geoIpUrl','GeoIP',n.geoIpUrl||DEFAULT_GEODATA.geoIpUrl,{placeholder:DEFAULT_GEODATA.geoIpUrl,hint:'Loyalsoldier · актуальный релиз geoip.dat · можно изменить'})+
 field('geoExtraSources','Дополнительные .dat',n.geoExtraSources||'',{area:true,rows:4,placeholder:'custom.dat https://example.org/custom.dat',hint:'Имя файла · HTTPS-ссылка · необязательный SHA-256'})+
 '</section></div>'+ 
 '<div class="geo-foot"><output class="geo-feedback" aria-live="polite"></output><div class="geo-buttons"><button type="button" class="gh geo-refresh" data-geo-refresh>Обновить сейчас</button><button type="submit" class="btn geo-save">Сохранить настройки</button></div></div></form>';
 modal(html,'geo-modal');
 const dialog=document.querySelector('dialog#dlg');
 const form=dialog?.querySelector('[data-geodata-form]');
 if(!form)return;
 const feedback=form.querySelector('.geo-feedback');
 const save=form.querySelector('.geo-save');
 const refresh=form.querySelector('.geo-refresh');
 function read(){
  const data=Object.fromEntries(KEYS.map(k=>[k,form.elements.namedItem(k)]).map(([k,input])=>[k,input.type==='checkbox'?input.checked:input.value.trim()]));
  data.geoUpdateHours=Number(data.geoUpdateHours);
  validate(data);return data;
 }
 async function persist(force){
  try{
   const values=read();
   if(!values.geoEnabled&&n.routingEnabled&&Array.isArray(n.routingRules)
      &&n.routingRules.some(rule=>rule.enabled!==false
        &&['geosite','geoip','extDomain','extIp'].includes(rule.matcher))){
     throw Error('GeoData используются в активных правилах маршрутизации. Сначала отключите эти правила в отдельном окне.');
   }
   const patch={...values};
   if(force){
    if(!values.geoEnabled)throw Error('Сначала включите GeoData.');
    patch.geoRefreshRevision=Number(n.geoRefreshRevision||0)+1;
   }
   save.disabled=true;refresh.disabled=true;feedback.textContent=force?'Запрашиваем обновление…':'Сохраняем…';
   await updateNode(patch);
   Object.assign(n,patch);
   feedback.textContent=force?'Запрос обновления сохранён. Нода применит его при следующей синхронизации.':'Настройки сохранены.';
   notify(force?'GeoData: запрос обновления отправлен':'Настройки GeoData сохранены');
   afterSave?.();
  }catch(error){feedback.textContent=error?.message||'Не удалось сохранить настройки.'}
  finally{save.disabled=false;refresh.disabled=false}
 }
 form.addEventListener('submit',event=>{event.preventDefault();void persist(false)});
 refresh.addEventListener('click',()=>void persist(true));
}
window.XMeshNodeGeoData={open};
})();