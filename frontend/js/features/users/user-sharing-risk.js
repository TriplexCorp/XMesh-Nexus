'use strict';

// Explainable anti-sharing intelligence for the Users table.
// The hard HWID limit remains server-enforced. This layer combines authoritative
// device slots with verified Xray traffic history and never treats traffic volume
// alone as proof of sharing.
(()=>{
  const cache=new Map();
  const TTL=60000;
  const HOUR=3600000;
  const DAY=24*HOUR;
  const GiB=1024**3;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const en=()=>globalThis.XMeshI18n?.getLanguage?.()==='en';
  const t=(ru,enText)=>en()?enText:ru;
  const fmtBytes=value=>{
    const n=Math.max(0,Number(value)||0);
    if(n>=1024**4)return (n/1024**4).toFixed(n>=10*1024**4?1:2)+' '+t('ТБ','TB');
    if(n>=GiB)return (n/GiB).toFixed(n>=10*GiB?1:2)+' '+t('ГБ','GB');
    return (n/1024**2).toFixed(0)+' '+t('МБ','MB');
  };
  const ago=ms=>{
    const value=Number(ms)||0;if(!value)return '—';
    const d=Math.max(0,Date.now()-value);
    if(d<60000)return t('сейчас','now');
    if(d<HOUR)return Math.floor(d/60000)+' '+t('мин','min');
    if(d<DAY)return Math.floor(d/HOUR)+' '+t('ч','h');
    return Math.floor(d/DAY)+' '+t('дн','d');
  };

  // Observable usage facts are not a probability of account sharing.
  // The server independently enforces HWID limits.
  function deviceSignals(user){
    const devices=Array.isArray(user?.devices)?user.devices:[];
    const now=Date.now(),first=d=>Number(d?.first)||0;
    return {
      devices,limit:Math.max(0,Number(user?.hwid)||0),
      new24h:devices.filter(d=>first(d)>0&&first(d)>=now-DAY&&first(d)<=now).length,
      new7d:devices.filter(d=>first(d)>0&&first(d)>=now-7*DAY&&first(d)<=now).length
    };
  }
  function trafficSignals(points){
    const now=Date.now();
    const valid=(Array.isArray(points)?points:[]).map(p=>({
      t:Number(p?.bucketMs)||0,
      bytes:Math.max(0,(Number(p?.uplinkBytes)||0)+(Number(p?.downlinkBytes)||0)),
      node:String(p?.nodeId??'')
    })).filter(p=>p.t>0&&p.t<=now);
    return {
      recent24h:valid.filter(p=>p.t>=now-DAY).reduce((n,p)=>n+p.bytes,0),
      recent7d:valid.filter(p=>p.t>=now-7*DAY).reduce((n,p)=>n+p.bytes,0),
      nodes6h:new Set(valid.filter(p=>p.t>=now-6*HOUR&&p.bytes>0&&p.node).map(p=>p.node)).size
    };
  }
  async function calculate(user){
    const devices=deviceSignals(user);
    let traffic={recent24h:0,recent7d:0,nodes6h:0},trafficAvailable=false;
    try{
      const history=await backendRequest('/api/v1/users/'+encodeURIComponent(user.id)+'/traffic/history?range=7d');
      if(Array.isArray(history?.points)){traffic=trafficSignals(history.points);trafficAvailable=true;}
    }catch(_error){/* Missing history must never be presented as zero traffic. */}
    return {devices,traffic,trafficAvailable,at:Date.now()};
  }
  function activityFor(user){
    const old=cache.get(user.id);
    const signature=JSON.stringify([user.hwid,user.devices||[]]);
    if(old&&old.signature===signature&&Date.now()-old.at<TTL)return old.promise;
    const entry={at:Date.now(),signature,promise:calculate(user)};
    cache.set(user.id,entry);
    entry.promise.then(()=>{entry.at=Date.now()}).catch(()=>cache.delete(user.id));
    return entry.promise;
  }

  function userById(id){
    return Array.isArray(globalThis.DB?.users)?globalThis.DB.users.find(user=>String(user.id)===String(id)):null;
  }

  function deviceIdentity(device){
    const raw=String(device.os||device.plat||'').trim(),phone=/android|ios|iphone/i.test(raw);
    let system=raw.split('_')[0].trim();
    const windows=raw.match(/windows(?:\s+(11|10|8\.1|8|7))?/i);
    if(windows){const major=windows[1]||String(device.osVersion||'').match(/^(11|10|8\.1|8|7)(?:_|$)/)?.[1];system='Windows'+(major?' '+major:'')}
    else if(/android/i.test(raw)){const version=raw.match(/android\s*(\d+)/i)||String(device.osVersion||'').match(/^(\d+)/);system='Android'+(version?' '+version[1]:'')}
    else if(/iphone|ios/i.test(raw))system='iOS';
    else if(/macos|mac os|darwin/i.test(raw))system='macOS';
    const type=phone?t('Телефон','Phone'):/windows|linux|mac|desktop/i.test(raw)?t('Компьютер','Computer'):t('Устройство','Device');
    const model=String(device.model||'').trim();
    const clean=model.replace(/(?:[_ -](?:x86_64|amd64|aarch64|arm64))$/i,'');
    const desktop=clean.match(/^DESKTOP[-_](.+)$/i);
    const label=desktop?t('Компьютер ','Computer ')+desktop[1]:clean||[type,system].filter(Boolean).join(' · ');
    return {icon:phone?'smartphone':'monitor',name:type,label,system:system||t('Система не указана','System not provided')};
  }
  function deviceCell(user){
    const count=Array.isArray(user?.devices)?user.devices.length:0,limit=Math.max(0,Number(user?.hwid)||0);
    const unit=en()?(count===1?'device':'devices'):({one:'устройство',few:'устройства',many:'устройств',other:'устройства'}[new Intl.PluralRules('ru').select(count)]);
    const policy=limit?t(`Лимит ${limit}`,`Limit ${limit}`):t('Без лимита','Unlimited');
    return `<button type="button" class="xm-device-count${count?'':' is-empty'}" data-sharing-detail="${esc(user.id)}" data-sharing-focus="devices" title="${esc(policy)}" aria-label="${t('Управлять устройствами','Manage devices')} · ${esc(user.username)}">${count?ic('monitor'):''}<span><b>${count?`${count} ${unit}`:t('Нет устройств','No devices')}</b>${count?`<small>${esc(policy)}</small>`:''}</span>${ic('chevronRight')}</button>`;
  }

  function activityCell(user){
    return `<button type="button" class="xm-activity-entry" data-sharing-detail="${esc(user.id)}" data-sharing-focus="activity" title="${t('Открыть историю активности','Open activity history')}" aria-label="${t('Активность пользователя','User activity')} · ${esc(user.username)}">${ic('activity')}<span>${t('История','History')}</span>${ic('chevronRight')}</button>`;
  }

  async function enhance(){
    if(location.hash!=='#users')return;
    const root=document.querySelector('#ut');
    const table=root?.querySelector('.tb');
    if(!table||table.dataset.sharingEnhanced==='1')return;
    const head=table.querySelector('thead tr');
    const actionHead=head?.querySelector('.user-row-actions-head');
    const lastSeenHead=actionHead?.previousElementSibling;
    if(!head||!lastSeenHead)return;
    const devicesHead=document.createElement('th');
    devicesHead.dataset.sharingHead='devices';devicesHead.textContent=t('Устройства','Devices');
    const riskHead=document.createElement('th');
    riskHead.dataset.sharingHead='risk';riskHead.textContent=t('Активность','Activity');
    head.insertBefore(devicesHead,lastSeenHead);
    head.insertBefore(riskHead,lastSeenHead);

    const rows=[...table.querySelectorAll('tbody tr[data-id]')];
    for(const row of rows){
      const user=userById(row.dataset.id);if(!user)continue;
      const action=row.lastElementChild;
      const lastSeen=action?.previousElementSibling;if(!lastSeen)continue;
      const device=document.createElement('td');device.dataset.l=t('Устройства','Devices');device.className='xm-sharing-devices-cell';device.innerHTML=deviceCell(user);
      const risk=document.createElement('td');risk.dataset.l=t('Активность','Activity');risk.className='xm-sharing-risk-cell';risk.innerHTML=activityCell(user);
      row.insertBefore(device,lastSeen);row.insertBefore(risk,lastSeen);
    }
    table.dataset.sharingEnhanced='1';

    root.querySelector('.xm-sharing-overview')?.remove();
  }

  function ensureDialog(){
    let dialog=document.querySelector('#xm-sharing-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='xm-sharing-dialog';dialog.className='xm-sharing-dialog';
    dialog.setAttribute('aria-labelledby','xm-sharing-title');
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    document.body.append(dialog);return dialog;
  }

  let detailRequest=0;
  async function openDetail(user,focus='devices',selectedId=null,inline=null){
    const request=++detailRequest,dialog=inline||ensureDialog();
    dialog.dataset.deviceRequest=String(request);
    const isOpen=()=>inline?dialog.isConnected&&Boolean(dialog.closest('dialog')?.open):dialog.open;
    const scopeIds=()=>{
      if(!inline)return;
      for(const node of dialog.querySelectorAll('[id]'))node.id='user-inline-'+node.id;
      for(const node of dialog.querySelectorAll('[aria-controls],[aria-labelledby]'))for(const attr of ['aria-controls','aria-labelledby'])if(node.hasAttribute(attr))node.setAttribute(attr,'user-inline-'+node.getAttribute(attr));
    };
    const isCurrent=()=>dialog.dataset.deviceRequest===String(request);
    const writable=typeof viewerMode==='function'&&!viewerMode();
    let tab=focus==='devices'?'devices':'activity',selected=selectedId,busy=false;
    if(!isOpen())dialog.dataset.deviceChanged='0';
    const relative=ms=>!Number(ms)?'—':Date.now()-Number(ms)<60000?t('сейчас','now'):`${ago(ms)} ${t('назад','ago')}`;
    const stamp=ms=>Number(ms)?new Date(Number(ms)).toLocaleString(en()?'en-US':'ru-RU'):'—';
    const head=()=>`<header class="xm-sharing-header"><div class="xm-sharing-heading"><span class="xm-sharing-emblem" aria-hidden="true">${ic("monitor")}</span><div class="xm-sharing-heading-copy"><span class="xm-sharing-kicker">${t("УПРАВЛЕНИЕ ПОДПИСКОЙ","SUBSCRIPTION MANAGEMENT")}</span><h2 id="xm-sharing-title">${t("Устройства и активность","Devices & activity")}</h2><p translate="no">${esc(user.username)}</p></div></div><button type="button" class="xm-sharing-close" aria-label="${t("Закрыть","Close")}">${ic("x")}</button></header>`;
    dialog.innerHTML=`<div class="xm-sharing-shell">${head()}<div class="xm-sharing-loading" role="status"><span class="xm-sharing-loading-icon" aria-hidden="true">${ic("activity")}</span><strong>${t("Загрузка устройств…","Loading devices…")}</strong></div></div>`;
    scopeIds();
    dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
    if(!isOpen())dialog.showModal();
    const result=await activityFor(user).catch(()=>null);
    if(!isCurrent()||!isOpen())return;
    if(!result){dialog.querySelector('.xm-sharing-loading').textContent=t('Не удалось загрузить данные. Откройте окно ещё раз.','Could not load data. Reopen this window to retry.');return;}
    function paint(){
      const devices=(user.devices||[]).slice().sort((a,b)=>(Number(b.last)||0)-(Number(a.last)||0));
      const device=devices.find(d=>String(d.id)===String(selected))||devices[0];
      selected=device?.id;
      const limit=Math.max(0,Number(user.hwid)||0),count=devices.length;
      const identity=device?deviceIdentity(device):null;
      const activityPanel=`<section id="xm-activity-panel" class="xm-activity-pane" role="tabpanel" aria-labelledby="xm-activity-tab" ${tab==='activity'?'':'hidden'}>
        <div class="xm-activity-head">
          <div><span class="xm-activity-eyebrow">${t('ДАННЫЕ ЗА 7 ДНЕЙ','LAST 7 DAYS')}</span><h3>${t('История активности','Activity history')}</h3><p>${t('Факты по устройствам и трафику без предположений о том, кто использует подписку.','Device and traffic facts without guessing who uses the subscription.')}</p></div>
          <span class="xm-activity-source ${result.trafficAvailable?'is-ready':'is-partial'}">${ic(result.trafficAvailable?'check':'info')}${result.trafficAvailable?t('История Xray доступна','Xray history available'):t('История Xray недоступна','Xray history unavailable')}</span>
        </div>
        <div class="xm-activity-stats">
          <div class="xm-activity-stat"><span>${t('Трафик / 24 ч','Traffic / 24h')}</span><strong>${result.trafficAvailable?fmtBytes(result.traffic.recent24h):'—'}</strong></div>
          <div class="xm-activity-stat"><span>${t('Трафик / 7 дней','Traffic / 7 days')}</span><strong>${result.trafficAvailable?fmtBytes(result.traffic.recent7d):'—'}</strong></div>
          <div class="xm-activity-stat"><span>${t('Серверов / 6 ч','Servers / 6h')}</span><strong>${result.trafficAvailable?result.traffic.nodes6h:'—'}</strong></div>
          <div class="xm-activity-stat"><span>${t('Новых устройств / 7 дней','New devices / 7 days')}</span><strong>${result.devices.new7d}</strong></div>
        </div>
        <div class="xm-activity-note">
          <span class="xm-activity-note-icon" aria-hidden="true">${ic('info')}</span>
          <p>${t('Смена сервера, добавление устройств и объём трафика сами по себе не подтверждают передачу доступа. Лимит устройств контролируется отдельно на сервере.','Server switching, added devices and traffic volume alone do not establish account sharing. Device limits are enforced separately by the server.')}</p>
          ${count?`<button type="button" class="xm-activity-view-devices" data-device-view-devices>${t('К устройствам','View devices')}${ic('chevronRight')}</button>`:''}
        </div>
      </section>`;
      dialog.innerHTML=`<div class="xm-sharing-shell">${head()}<div class="xm-device-toolbar"><div class="xm-device-tabs" role="tablist" aria-label="${t('Раздел устройства','Device sections')}"><button type="button" role="tab" id="xm-devices-tab" aria-controls="xm-devices-panel" aria-selected="${tab==='devices'}" data-device-tab="devices" tabindex="${tab==='devices'?0:-1}">${ic("monitor")}${t('Устройства','Devices')} <span>${count}</span></button><button type="button" role="tab" id="xm-activity-tab" aria-controls="xm-activity-panel" aria-selected="${tab==='activity'}" data-device-tab="activity" tabindex="${tab==='activity'?0:-1}">${ic("activity")}${t('Активность','Activity')}</button></div><button type="button" class="xm-device-limit" data-device-limit-open ${writable?'':'disabled'}>${limit?t(`Лимит: ${limit}`,`Limit: ${limit}`):t('Без лимита','Unlimited')}${writable?ic('pen'):''}</button></div><div class="xm-sharing-body"><div id="xm-devices-panel" role="tabpanel" aria-labelledby="xm-devices-tab" ${tab==='devices'?'':'hidden'}>${count?`<div class="xm-device-workbench"><nav class="xm-device-picker" aria-label="${t('Выбрать устройство','Select a device')}">${devices.map(d=>{const i=deviceIdentity(d);return `<button type="button" class="xm-sharing-device" data-device-select="${esc(d.id)}" aria-pressed="${String(d.id)===String(selected)}">${ic(i.icon)}<span><b>${esc(i.label)}</b><small>${esc(i.system)}${d.app?' · '+esc(d.app):''}</small></span>${ic('chevronRight')}</button>`}).join('')}</nav><section class="xm-device-inspector" aria-label="${t('Сведения об устройстве','Device information')}"><div class="xm-device-identity"><span class="xm-device-glyph">${ic(identity.icon)}</span><div><h3>${esc(identity.label)}</h3><p>${esc(identity.system)}${device.app?' · '+esc(device.app):''}</p></div></div><dl class="xm-device-facts"><div><dt>${t('Подписка обновлена','Subscription refreshed')}</dt><dd title="${esc(stamp(device.last))}">${esc(relative(device.last))}</dd></div><div><dt>${t('Добавлено','Added')}</dt><dd>${esc(Number(device.first)?new Date(Number(device.first)).toLocaleDateString(en()?'en-US':'ru-RU', {year:'numeric',month:'short',day:'numeric'}):'—')}</dd></div></dl><details class="xm-sharing-device-details"><summary>${t('Идентификатор и диагностика','Identifier & diagnostics')}</summary><dl><div><dt>HWID</dt><dd>${esc(device.fingerprint||'—')}</dd></div><div><dt>${t('Обновлений подписки','Subscription refreshes')}</dt><dd>${esc(device.refreshes??0)}</dd></div><div><dt>${t('Имя устройства','Device hostname')}</dt><dd>${esc(device.model||'—')}</dd></div><div><dt>${t('Система и сборка','System & build')}</dt><dd>${esc([device.os||device.plat,device.osVersion].filter(Boolean).join(' · ')||'—')}</dd></div></dl><p class="xm-device-context">${t('Время обновления подписки в приложении. Оно не показывает, подключён ли сейчас VPN.','The last subscription refresh in the app. This does not indicate a live VPN connection.')}</p></details>${writable?`<div class="xm-device-actions"><button type="button" class="gh" data-device-remove>${ic('trash')}${t('Удалить устройство','Remove device')}</button></div>`:''}</section></div>`:`<div class="xm-sharing-empty">${ic('monitor')}<h3>${t('Пока ни одного устройства','No devices yet')}</h3><p>${t('Передайте пользователю ссылку подписки. Привязка появится, когда приложение впервые её обновит.','Give the user their subscription link. A binding appears when their app first refreshes it.')}</p></div>`}<p class="xm-device-capacity" role="status">${limit?(count>limit?t(`Лимит превышен: ${count} из ${limit}`,`Over limit: ${count} of ${limit}`):count===limit?t('Все места заняты','All slots are used'):t(`Свободных мест: ${limit-count}`,`Available slots: ${limit-count}`)):t('Количество устройств не ограничено','Device count is unlimited')}</p></div>${activityPanel}<form class="xm-device-limit-form" hidden><label>${t('Лимит устройств','Device limit')}<input type="number" name="limit" min="0" step="1" required value="${limit}"></label><p>${t('0 — без ограничений. Изменение лимита не удаляет уже зарегистрированные устройства.','0 means unlimited. Changing this limit does not remove existing devices.')}</p><div><button type="button" class="gh" data-device-limit-cancel>${t('Отмена','Cancel')}</button><button class="btn">${t('Сохранить лимит','Save limit')}</button></div></form><p class="xm-device-feedback" role="status" aria-live="polite"></p></div></div>`;
      scopeIds();
    dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
      for(const button of dialog.querySelectorAll('[data-device-tab]'))button.onclick=()=>{tab=button.dataset.deviceTab;paint();dialog.querySelector(`[data-device-tab="${tab}"]`).focus()};
      const tabs=[...dialog.querySelectorAll('[role=tab]')];
      tabs.forEach((button,index)=>button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length].click()}});
      for(const button of dialog.querySelectorAll('[data-device-select]'))button.onclick=()=>{selected=button.dataset.deviceSelect;paint();dialog.querySelector(`[data-device-select="${selected}"]`)?.focus()};
      dialog.querySelector('[data-device-view-devices]')?.addEventListener('click',()=>dialog.querySelector('[data-device-tab="devices"]')?.click());
      const limitForm=dialog.querySelector('.xm-device-limit-form'),feedback=dialog.querySelector('.xm-device-feedback');
      dialog.querySelector('[data-device-limit-open]').onclick=()=>{if(!writable)return;limitForm.hidden=false;limitForm.elements.limit.focus()};
      dialog.querySelector('[data-device-limit-cancel]').onclick=()=>{limitForm.hidden=true;dialog.querySelector('[data-device-limit-open]').focus()};
      async function update(patch,deviceId=null){
        if(busy||!writable)return;busy=true;
        dialog.querySelectorAll('[data-device-remove],.xm-device-limit-form button').forEach(b=>b.disabled=true);
        const draftLimit=inline?.closest('.user-canvas')?.querySelector('[data-hw]');
        const syncLimit=draftLimit&&Number(draftLimit.value)===Number(user.hwid);
        try{if(deviceId!==null)await removeUserDevice(user.id,deviceId);else await api.update('users',user.id,patch);if(syncLimit&&patch?.hwid!==undefined)draftLimit.value=String(patch.hwid);cache.delete(user.id);dialog.dataset.deviceChanged='1';if(isOpen()&&isCurrent())await openDetail(userById(user.id)||user,tab,selected,inline);else refreshViews()}
        catch(error){feedback.textContent=t('Не удалось сохранить: ','Could not save: ')+(error.message||t('Ошибка API','API error'));dialog.querySelectorAll('[data-device-remove],.xm-device-limit-form button').forEach(b=>b.disabled=false)}
        finally{busy=false}
      }
      limitForm.onsubmit=e=>{e.preventDefault();const value=Number(limitForm.elements.limit.value);if(!limitForm.reportValidity()||!Number.isSafeInteger(value)||value<0)return;void update({hwid:value})};
      const remove=dialog.querySelector('[data-device-remove]');
      if(remove)remove.onclick=async()=>{
        if(busy)return;
        const deviceId=selected;
        busy=true;let confirmed=false;
        try{confirmed=await panelConfirm(t('Привязка будет удалена и освободит место. Это не блокирует устройство: при следующем обновлении подписки клиент сможет зарегистрироваться снова.','Removing this binding frees a slot. It does not block the device: the client can register again on its next subscription refresh.'),{title:t('Удалить привязку устройства?','Remove device binding?'),confirmLabel:t('Удалить привязку','Remove binding'),danger:true})}finally{busy=false}
        if(confirmed&&isOpen()&&isCurrent())await update(null,deviceId);
      };
    }
    paint();dialog.dataset.focus=focus;if(!inline)dialog.querySelector('.xm-sharing-close').focus({preventScroll:true});
    function refreshViews(){
      if(dialog.dataset.deviceChanged!=='1')return;
      dialog.dataset.deviceChanged='0';
      const parent=document.querySelector('#dlg.user-modal[open]');
      if(parent?.querySelector(`[data-open-user-traffic="${user.id}"]`))userDrawer(user.id,UT);
      else if(location.hash==='#users')render(1);
      else if(location.hash==='#tools')drawTools();
    }
    if(!inline)dialog.onclose=refreshViews;
  }

  window.XMeshUserDevices=Object.freeze({mount:(root,id)=>{
    const user=userById(id);if(!user||!root)return;
    root.closest('dialog')?.addEventListener('close',()=>{if(root.dataset.deviceChanged==='1'&&location.hash==='#users')render(1)},{once:true});
    void openDetail(user,'devices',null,root);
  }});

  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-sharing-detail]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const user=userById(button.dataset.sharingDetail);if(user)void openDetail(user,button.dataset.sharingFocus,button.dataset.sharingDevice??null);
  },true);

  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void enhance();});};
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);
  schedule();
})();
