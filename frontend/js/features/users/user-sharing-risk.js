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

  function deviceSignals(user){
    const now=Date.now();
    const devices=Array.isArray(user?.devices)?user.devices:[];
    const limit=Math.max(0,Number(user?.hwid)||0);
    const first=device=>Number(device?.first)||0;
    const new1h=devices.filter(device=>first(device)>=now-HOUR).length;
    const new24h=devices.filter(device=>first(device)>=now-DAY).length;
    const new7d=devices.filter(device=>first(device)>=now-7*DAY).length;
    const recentPlatforms=new Set(devices.filter(device=>first(device)>=now-DAY).map(device=>String(device?.plat||'unknown'))).size;
    const factors=[];
    let score=0;
    if(new1h>=2){const pts=Math.min(30,22+(new1h-2)*4);score+=pts;factors.push({points:pts,key:'deviceBurst',text:t(`${new1h} новых устройства за час`,`${new1h} new devices in one hour`)});}
    else if(new24h>=2){const pts=Math.min(26,14+(new24h-2)*4);score+=pts;factors.push({points:pts,key:'deviceGrowth',text:t(`${new24h} новых устройства за 24 часа`,`${new24h} new devices in 24 hours`)});}
    if(new7d>=4){const pts=Math.min(14,8+(new7d-4)*2);score+=pts;factors.push({points:pts,key:'weeklyDevices',text:t(`${new7d} устройств появились за неделю`,`${new7d} devices appeared this week`)});}
    if(recentPlatforms>=3){score+=8;factors.push({points:8,key:'platformSpread',text:t(`${recentPlatforms} платформы среди новых устройств`,`${recentPlatforms} platforms among recent devices`)});}
    return {score,factors,devices,limit,new1h,new24h,new7d};
  }

  function trafficSignals(points){
    const now=Date.now();
    const usable=(Array.isArray(points)?points:[]).map(point=>({
      t:Number(point?.bucketMs)||0,
      bytes:(Number(point?.uplinkBytes)||0)+(Number(point?.downlinkBytes)||0),
      node:String(point?.nodeId??'')
    })).filter(point=>point.t>0&&point.bytes>=0);
    const sum=(from,to=now)=>usable.filter(point=>point.t>=from&&point.t<to).reduce((total,point)=>total+point.bytes,0);
    const recent3h=sum(now-3*HOUR);
    const recent24h=sum(now-DAY);
    const previous6d=sum(now-7*DAY,now-DAY);
    const baselineHour=previous6d/(6*24);
    const baselineDay=previous6d/6;
    const hourlyRatio=baselineHour>0?(recent3h/3)/baselineHour:0;
    const dailyRatio=baselineDay>0?recent24h/baselineDay:0;
    const nodes6h=new Set(usable.filter(point=>point.t>=now-6*HOUR&&point.bytes>0&&point.node).map(point=>point.node)).size;
    const factors=[];
    let score=0;
    if(recent3h>=6*GiB&&hourlyRatio>=4){const pts=hourlyRatio>=8?23:16;score+=pts;factors.push({points:pts,key:'trafficBurst',text:t(`скорость трафика ~${hourlyRatio.toFixed(1)}× выше недельной нормы`,`traffic velocity is ~${hourlyRatio.toFixed(1)}× above weekly baseline`)});}
    if(nodes6h>=2){const pts=nodes6h>=3?20:12;score+=pts;factors.push({points:pts,key:'nodeSpread',text:t(`активность сразу через ${nodes6h} ноды за 6 часов`,`activity across ${nodes6h} nodes in 6 hours`)});}
    if(recent24h>=20*GiB&&dailyRatio>=4){score+=10;factors.push({points:10,key:'dailyBurst',text:t(`суточный трафик ~${dailyRatio.toFixed(1)}× выше обычного`,`daily traffic is ~${dailyRatio.toFixed(1)}× above baseline`)});}
    return {score,factors,recent3h,recent24h,baselineHour,baselineDay,hourlyRatio,dailyRatio,nodes6h};
  }

  function tier(score){
    if(score>=75)return {key:'high',label:t('Высокий','High')};
    if(score>=50)return {key:'elevated',label:t('Повышенный','Elevated')};
    if(score>=25)return {key:'watch',label:t('Наблюдение','Watch')};
    return {key:'normal',label:t('Норма','Normal')};
  }

  async function calculate(user){
    const devices=deviceSignals(user);
    let traffic={score:0,factors:[],recent3h:0,recent24h:0,baselineHour:0,baselineDay:0,hourlyRatio:0,dailyRatio:0,nodes6h:0};
    let trafficAvailable=true;
    try{
      const history=await backendRequest('/api/v1/users/'+encodeURIComponent(user.id)+'/traffic/history?range=7d');
      traffic=trafficSignals(history?.points);
    }catch(_error){trafficAvailable=false;}
    const score=Math.min(100,devices.score+traffic.score);
    return {score,tier:tier(score),factors:[...devices.factors,...traffic.factors].sort((a,b)=>b.points-a.points),devices,traffic,trafficAvailable,at:Date.now()};
  }

  function riskFor(user){
    const old=cache.get(user.id);
    const signature=JSON.stringify([user.hwid,user.devices||[]]);
    if(old&&old.signature===signature&&Date.now()-old.at<TTL)return old.promise;
    const entry={at:Date.now(),signature,promise:calculate(user)};
    cache.set(user.id,entry);
    entry.promise.then(()=>{entry.at=Date.now();}).catch(()=>cache.delete(user.id));
    return entry.promise;
  }

  function userById(id){
    return Array.isArray(globalThis.DB?.users)?globalThis.DB.users.find(user=>String(user.id)===String(id)):null;
  }

  function deviceIdentity(device){
    const platform=String(device.os||device.plat||'').toLowerCase();
    const phone=/android|ios|iphone/.test(platform);
    return {icon:phone?'smartphone':'monitor',name:phone?t('Телефон','Phone'):/windows|linux|mac|desktop/.test(platform)?t('Компьютер','Computer'):t('Устройство','Device'),system:[device.os||device.plat,device.osVersion].filter(Boolean).join(' ')||t('Система не указана','System not provided')};
  }
  function deviceCell(user){
    const devices=Array.isArray(user?.devices)?user.devices:[],limit=Math.max(0,Number(user?.hwid)||0);
    return `<button type="button" class="xm-device-count" data-sharing-detail="${esc(user.id)}" data-sharing-focus="devices" aria-label="${t('Управлять устройствами','Manage devices')} · ${esc(user.username)}">${ic('monitor')}<span><b>${devices.length} ${t('устр.','devices')}</b><small>${limit?t(`Лимит ${limit}`,`Limit ${limit}`):t('Без лимита','Unlimited')}</small></span>${ic('chevronRight')}</button>`;
  }

  function riskCellLoading(user){
    return `<button type="button" class="xm-risk-pill is-loading" data-sharing-detail="${esc(user.id)}" data-sharing-focus="risk"><span></span>${t('Анализ…','Analysing…')}</button>`;
  }

  function renderRiskCell(cell,result,user){
    if(!cell?.isConnected)return;
    cell.innerHTML=`<button type="button" class="xm-risk-pill is-${result.tier.key}" data-sharing-detail="${esc(user.id)}" data-sharing-focus="risk">${ic(result.tier.key==='normal'?'check':'activity')}<span>${esc(result.tier.key==='normal'?t('Без сигналов','No signals'):result.tier.label)}</span></button>`;
    cell.dataset.risk=result.tier.key;
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
    riskHead.dataset.sharingHead='risk';riskHead.textContent=t('Проверка','Assessment');
    head.insertBefore(devicesHead,lastSeenHead);
    head.insertBefore(riskHead,lastSeenHead);

    const rows=[...table.querySelectorAll('tbody tr[data-id]')];
    const tasks=[];
    for(const row of rows){
      const user=userById(row.dataset.id);if(!user)continue;
      const action=row.lastElementChild;
      const lastSeen=action?.previousElementSibling;if(!lastSeen)continue;
      const device=document.createElement('td');device.dataset.l=t('Устройства','Devices');device.className='xm-sharing-devices-cell';device.innerHTML=deviceCell(user);
      const risk=document.createElement('td');risk.dataset.l=t('Риск','Risk');risk.className='xm-sharing-risk-cell';risk.innerHTML=riskCellLoading(user);
      row.insertBefore(device,lastSeen);row.insertBefore(risk,lastSeen);
      tasks.push(riskFor(user).then(result=>renderRiskCell(risk,result,user)).catch(()=>{if(risk.isConnected)risk.innerHTML='<span class="xm-risk-unavailable">—</span>';}));
    }
    table.dataset.sharingEnhanced='1';

    const wrap=table.closest('.tw');
    if(wrap&&!root.querySelector('.xm-sharing-overview')){
      const overview=document.createElement('div');overview.className='xm-sharing-overview';overview.hidden=true;
      overview.innerHTML=`<div><span class="xm-sharing-mark"></span><b>Anti-sharing</b><span>${t('HWID + подтверждённый Xray-трафик','HWID + verified Xray traffic')}</span></div><span data-sharing-overview-count>${t('анализируется…','analysing…')}</span>`;
      wrap.before(overview);
      Promise.allSettled(tasks).then(()=>{
        if(!overview.isConnected)return;
        const high=root.querySelectorAll('.xm-risk-pill.is-high').length;
        const elevated=root.querySelectorAll('.xm-risk-pill.is-elevated').length;
        const watch=root.querySelectorAll('.xm-risk-pill.is-watch').length;
        const count=high+elevated+watch;overview.hidden=count===0;
        overview.innerHTML=`<span>${ic('activity')} ${t('Проверка устройств','Device assessment')}</span><span>${t(`Требуют внимания: ${count}`,`Review suggested: ${count}`)}</span>`;
      });
    }
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
  async function openDetail(user,focus='devices',selectedId=null){
    const request=++detailRequest,dialog=ensureDialog();
    const writable=typeof viewerMode==='function'&&!viewerMode();
    let tab=focus==='risk'?'risk':'devices',selected=selectedId,busy=false;
    if(!dialog.open)dialog.dataset.deviceChanged='0';
    const relative=ms=>!Number(ms)?'—':Date.now()-Number(ms)<60000?t('сейчас','now'):`${ago(ms)} ${t('назад','ago')}`;
    const stamp=ms=>Number(ms)?new Date(Number(ms)).toLocaleString(en()?'en-US':'ru-RU'):'—';
    const head=()=>`<header><div><h2 id="xm-sharing-title">${t('Устройства и доступ','Devices & access')}</h2><p>${esc(user.username)}</p></div><button type="button" class="xm-sharing-close" aria-label="${t('Закрыть','Close')}">${ic('x')}</button></header>`;
    dialog.innerHTML=`<div class="xm-sharing-shell">${head()}<div class="xm-sharing-loading" role="status">${t('Загрузка устройств…','Loading devices…')}</div></div>`;
    dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
    if(!dialog.open)dialog.showModal();
    const result=await riskFor(user).catch(()=>null);
    if(request!==detailRequest||!dialog.open)return;
    if(!result){dialog.querySelector('.xm-sharing-loading').textContent=t('Не удалось загрузить данные. Откройте окно ещё раз.','Could not load data. Reopen this window to retry.');return;}
    function paint(){
      const devices=(user.devices||[]).slice().sort((a,b)=>(Number(b.last)||0)-(Number(a.last)||0));
      const device=devices.find(d=>String(d.id)===String(selected))||devices[0];
      selected=device?.id;
      const limit=Math.max(0,Number(user.hwid)||0),count=devices.length;
      const identity=device?deviceIdentity(device):null;
      const reasons=result.factors.length?result.factors.map(f=>`<li><b>+${f.points}</b><span>${esc(f.text)}</span></li>`).join(''):`<li class="is-clean">${ic('check')}<span>${t('Признаков совместного использования не обнаружено','No sharing signals detected')}</span></li>`;
      dialog.innerHTML=`<div class="xm-sharing-shell">${head()}<div class="xm-device-toolbar"><div class="xm-device-tabs" role="tablist" aria-label="${t('Раздел устройства','Device sections')}"><button type="button" role="tab" id="xm-devices-tab" aria-controls="xm-devices-panel" aria-selected="${tab==='devices'}" data-device-tab="devices">${t('Устройства','Devices')} <span>${count}</span></button><button type="button" role="tab" id="xm-assessment-tab" aria-controls="xm-assessment-panel" aria-selected="${tab==='risk'}" data-device-tab="risk">${t('Проверка доступа','Access assessment')}</button></div><button type="button" class="xm-device-limit" data-device-limit-open ${writable?'':'disabled'}>${limit?t(`Лимит: ${limit}`,`Limit: ${limit}`):t('Без лимита','Unlimited')}${writable?ic('pen'):''}</button></div><div class="xm-sharing-body"><div id="xm-devices-panel" role="tabpanel" aria-labelledby="xm-devices-tab" ${tab==='devices'?'':'hidden'}>${count?`<div class="xm-device-workbench"><nav class="xm-device-picker" aria-label="${t('Выбрать устройство','Select a device')}">${devices.map(d=>{const i=deviceIdentity(d);return `<button type="button" class="xm-sharing-device" data-device-select="${esc(d.id)}" aria-pressed="${String(d.id)===String(selected)}">${ic(i.icon)}<span><b>${esc(i.name)} · ${esc(i.system)}</b><small>${esc(d.app||t('Клиент не указан','Client not provided'))} · ${esc(relative(d.last))}</small><span class="xm-device-hostname">${esc(d.model||t('Без названия','Unnamed'))}</span></span>${ic('chevronRight')}</button>`}).join('')}</nav><section class="xm-device-inspector" aria-label="${t('Сведения об устройстве','Device information')}"><div class="xm-device-identity"><span class="xm-device-glyph">${ic(identity.icon)}</span><div><h3>${esc(identity.name)}</h3><p>${esc(identity.system)}${device.app?' · '+esc(device.app):''}</p></div></div><p class="xm-device-name">${esc(device.model||t('Без названия','Unnamed'))}</p><dl class="xm-device-facts"><div><dt>${t('Обращение к подписке','Subscription request')}</dt><dd title="${esc(stamp(device.last))}">${esc(relative(device.last))}</dd></div><div><dt>${t('Первое подключение клиента','First client registration')}</dt><dd>${esc(stamp(device.first))}</dd></div></dl><p class="xm-device-context">${t('Время обновления подписки в приложении. Оно не показывает, подключён ли сейчас VPN.','The last subscription refresh in the app. This does not indicate a live VPN connection.')}</p><details class="xm-sharing-device-details"><summary>${t('Идентификатор и диагностика','Identifier & diagnostics')}</summary><dl><div><dt>HWID</dt><dd>${esc(device.fingerprint||'—')}</dd></div><div><dt>${t('Обновлений подписки','Subscription refreshes')}</dt><dd>${esc(device.refreshes??0)}</dd></div></dl></details>${writable?`<div class="xm-device-actions"><button type="button" class="gh" data-device-remove>${ic('trash')}${t('Удалить привязку','Remove binding')}</button><span>${t('Освободит место для другого устройства','Frees a slot for another device')}</span></div>`:''}</section></div>`:`<div class="xm-sharing-empty">${ic('monitor')}<h3>${t('Пока ни одного устройства','No devices yet')}</h3><p>${t('Передайте пользователю ссылку подписки. Привязка появится, когда приложение впервые её обновит.','Give the user their subscription link. A binding appears when their app first refreshes it.')}</p></div>`}<p class="xm-device-capacity" role="status">${limit?(count>limit?t(`Лимит превышен: ${count} из ${limit}. Измените лимит или удалите лишние привязки.`,`Over limit: ${count} of ${limit}. Adjust the limit or remove bindings.`):count===limit?t(`Используются все ${limit} места. Для нового устройства освободите место или увеличьте лимит.`,`All ${limit} slots are used. Free a slot or increase the limit for a new device.`):t(`Используется ${count} из ${limit} мест`,`Using ${count} of ${limit} slots`)):t('Количество устройств не ограничено','Device count is unlimited')}</p></div><section id="xm-assessment-panel" role="tabpanel" aria-labelledby="xm-assessment-tab" ${tab==='risk'?'':'hidden'}><div class="xm-assessment-heading"><h3>${result.tier.key==='normal'?t('Поводов для проверки нет','No review needed'):t('Стоит проверить доступ','Access is worth reviewing')}</h3><span class="xm-sharing-score is-${result.tier.key}">${result.score}<small>/100</small></span></div><p class="xm-sharing-period">${t('Сигналы за последние 7 дней. Заполненный лимит сам по себе не считается подозрительным.','Signals from the last 7 days. Filling the device limit is not suspicious on its own.')}</p><ul class="xm-sharing-reasons">${reasons}</ul><div class="xm-sharing-metrics"><div><span>${t('Трафик за 24 часа','Traffic in 24 hours')}</span><b>${result.trafficAvailable?fmtBytes(result.traffic.recent24h):t('Нет данных','Unavailable')}</b></div><div><span>${t('Серверов за 6 часов','Servers in 6 hours')}</span><b>${result.trafficAvailable?result.traffic.nodes6h:'—'}</b></div><div><span>${t('Новых устройств за сутки','New devices in 24 hours')}</span><b>${result.devices.new24h}</b></div></div><p class="xm-sharing-footnote">${t('Высокий объём трафика сам по себе не считается sharing. Проверка не блокирует устройства автоматически.','High traffic volume alone is not treated as sharing. The assessment does not automatically block devices.')}${result.trafficAvailable?'':t(' История трафика недоступна; учтены только устройства.',' Traffic history is unavailable; only device signals are included.')}</p></section><form class="xm-device-limit-form" hidden><label>${t('Лимит устройств','Device limit')}<input type="number" name="limit" min="0" step="1" required value="${limit}"></label><p>${t('0 — без ограничений. Изменение лимита не удаляет уже зарегистрированные устройства.','0 means unlimited. Changing this limit does not remove existing devices.')}</p><div><button type="button" class="gh" data-device-limit-cancel>${t('Отмена','Cancel')}</button><button class="btn">${t('Сохранить лимит','Save limit')}</button></div></form><p class="xm-device-feedback" role="status" aria-live="polite"></p></div></div>`;
      dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
      for(const button of dialog.querySelectorAll('[data-device-tab]'))button.onclick=()=>{tab=button.dataset.deviceTab;paint();dialog.querySelector(`[data-device-tab="${tab}"]`).focus()};
      const tabs=[...dialog.querySelectorAll('[role=tab]')];
      tabs.forEach((button,index)=>button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length].click()}});
      for(const button of dialog.querySelectorAll('[data-device-select]'))button.onclick=()=>{selected=button.dataset.deviceSelect;paint();dialog.querySelector(`[data-device-select="${selected}"]`)?.focus()};
      const limitForm=dialog.querySelector('.xm-device-limit-form'),feedback=dialog.querySelector('.xm-device-feedback');
      dialog.querySelector('[data-device-limit-open]').onclick=()=>{if(!writable)return;limitForm.hidden=false;limitForm.elements.limit.focus()};
      dialog.querySelector('[data-device-limit-cancel]').onclick=()=>{limitForm.hidden=true;dialog.querySelector('[data-device-limit-open]').focus()};
      async function update(patch){
        if(busy||!writable)return;busy=true;
        dialog.querySelectorAll('[data-device-remove],.xm-device-limit-form button').forEach(b=>b.disabled=true);
        try{await api.update('users',user.id,patch);cache.delete(user.id);dialog.dataset.deviceChanged='1';if(dialog.open&&request===detailRequest)await openDetail(userById(user.id)||user,tab,selected);else refreshViews()}
        catch(error){feedback.textContent=t('Не удалось сохранить: ','Could not save: ')+(error.message||t('Ошибка API','API error'));dialog.querySelectorAll('[data-device-remove],.xm-device-limit-form button').forEach(b=>b.disabled=false)}
        finally{busy=false}
      }
      limitForm.onsubmit=e=>{e.preventDefault();const value=Number(limitForm.elements.limit.value);if(!limitForm.reportValidity()||!Number.isSafeInteger(value)||value<0)return;void update({hwid:value})};
      const remove=dialog.querySelector('[data-device-remove]');
      if(remove)remove.onclick=async()=>{
        if(busy)return;
        busy=true;let confirmed=false;
        try{confirmed=await panelConfirm(t('Привязка будет удалена и освободит место. Это не блокирует устройство: при следующем обновлении подписки клиент сможет зарегистрироваться снова.','Removing this binding frees a slot. It does not block the device: the client can register again on its next subscription refresh.'),{title:t('Удалить привязку устройства?','Remove device binding?'),confirmLabel:t('Удалить привязку','Remove binding'),danger:true})}finally{busy=false}
        if(confirmed&&dialog.open&&request===detailRequest)await update({devices:(userById(user.id)?.devices||[]).filter(d=>String(d.id)!==String(selected))});
      };
    }
    paint();dialog.dataset.focus=focus;dialog.querySelector('.xm-sharing-close').focus({preventScroll:true});
    function refreshViews(){
      if(dialog.dataset.deviceChanged!=='1')return;
      dialog.dataset.deviceChanged='0';
      const parent=document.querySelector('#dlg.user-modal[open]');
      if(parent?.querySelector(`[data-open-user-traffic="${user.id}"]`))userDrawer(user.id,UT);
      else if(location.hash==='#users')render(1);
      else if(location.hash==='#tools')drawTools();
    }
    dialog.onclose=refreshViews;
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-sharing-detail]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const user=userById(button.dataset.sharingDetail);if(user)void openDetail(user,button.dataset.sharingFocus);
  },true);

  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void enhance();});};
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);
  schedule();
})();
