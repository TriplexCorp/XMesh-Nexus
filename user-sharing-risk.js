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
    if(limit>0&&devices.length>=limit){score+=10;factors.push({points:10,key:'slotPressure',text:t(`занято ${devices.length} из ${limit} слотов`,`using ${devices.length} of ${limit} slots`)});}
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
    if(old&&Date.now()-old.at<TTL)return old.promise;
    const entry={at:Date.now(),promise:calculate(user)};
    cache.set(user.id,entry);
    entry.promise.then(()=>{entry.at=Date.now();}).catch(()=>cache.delete(user.id));
    return entry.promise;
  }

  function userById(id){
    return Array.isArray(globalThis.DB?.users)?globalThis.DB.users.find(user=>String(user.id)===String(id)):null;
  }

  function deviceCell(user){
    const count=Array.isArray(user?.devices)?user.devices.length:0;
    const limit=Math.max(0,Number(user?.hwid)||0);
    const value=limit?`${count} / ${limit}`:`${count} / ∞`;
    const state=limit&&count>=limit?' is-full':'';
    return `<button type="button" class="xm-device-count${state}" data-sharing-detail="${esc(user.id)}" data-sharing-focus="devices"><span class="xm-device-dot"></span><b>${esc(value)}</b></button>`;
  }

  function riskCellLoading(user){
    return `<button type="button" class="xm-risk-pill is-loading" data-sharing-detail="${esc(user.id)}" data-sharing-focus="risk"><span></span>${t('Анализ…','Analysing…')}</button>`;
  }

  function renderRiskCell(cell,result,user){
    if(!cell?.isConnected)return;
    cell.innerHTML=`<button type="button" class="xm-risk-pill is-${result.tier.key}" data-sharing-detail="${esc(user.id)}" data-sharing-focus="risk"><strong>${result.score}</strong><span>${esc(result.tier.label)}</span></button>`;
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
    riskHead.dataset.sharingHead='risk';riskHead.textContent=t('Риск','Risk');
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
      const overview=document.createElement('div');overview.className='xm-sharing-overview';
      overview.innerHTML=`<div><span class="xm-sharing-mark"></span><b>Anti-sharing</b><span>${t('HWID + подтверждённый Xray-трафик','HWID + verified Xray traffic')}</span></div><span data-sharing-overview-count>${t('анализируется…','analysing…')}</span>`;
      wrap.before(overview);
      Promise.allSettled(tasks).then(()=>{
        if(!overview.isConnected)return;
        const high=root.querySelectorAll('.xm-risk-pill.is-high').length;
        const elevated=root.querySelectorAll('.xm-risk-pill.is-elevated').length;
        const watch=root.querySelectorAll('.xm-risk-pill.is-watch').length;
        overview.querySelector('[data-sharing-overview-count]').textContent=t(`высокий ${high} · повышенный ${elevated} · наблюдение ${watch}`,`high ${high} · elevated ${elevated} · watch ${watch}`);
      });
    }
  }

  function ensureDialog(){
    let dialog=document.querySelector('#xm-sharing-dialog');
    if(dialog)return dialog;
    dialog=document.createElement('dialog');dialog.id='xm-sharing-dialog';dialog.className='xm-sharing-dialog';
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    document.body.append(dialog);return dialog;
  }

  function deviceName(device){return [device?.model,device?.os||device?.plat,device?.app].filter(Boolean).join(' · ')||t('Неизвестное устройство','Unknown device');}

  async function openDetail(user,focus){
    const dialog=ensureDialog();
    dialog.innerHTML=`<div class="xm-sharing-shell"><header><div><span class="xm-sharing-kicker">ANTI-SHARING</span><h2>${esc(user.username)}</h2><p>${t('Анализ устройств и поведения подписки','Subscription device and behavior analysis')}</p></div><button type="button" class="xm-sharing-close" aria-label="${t('Закрыть','Close')}">×</button></header><div class="xm-sharing-loading">${t('Анализируем подтверждённые данные…','Analysing verified signals…')}</div></div>`;
    dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
    if(!dialog.open)dialog.showModal();
    const result=await riskFor(user).catch(()=>null);if(!result||!dialog.open)return;
    const devices=result.devices.devices;
    const reasons=result.factors.length?result.factors.map(item=>`<li><b>+${item.points}</b><span>${esc(item.text)}</span></li>`).join(''):`<li class="is-clean"><b>0</b><span>${t('Подозрительных сигналов не обнаружено','No suspicious signals detected')}</span></li>`;
    const deviceRows=devices.length?devices.map(device=>`<article><div class="xm-sharing-device-icon">${esc(String(device.plat||'?').slice(0,1).toUpperCase())}</div><div><b>${esc(deviceName(device))}</b><span>${t('последняя активность','last seen')}: ${ago(device.last)} · ${t('добавлено','added')}: ${ago(device.first)}</span><small>#${esc(device.fingerprint||'—')} · ${t('обновлений','refreshes')}: ${esc(device.refreshes??0)}</small></div></article>`).join(''):`<p class="xm-sharing-empty">${t('Зарегистрированных HWID пока нет.','No registered HWIDs yet.')}</p>`;
    const protection=result.devices.limit>0?t(`Серверный лимит активен: ${devices.length} / ${result.devices.limit}`,`Server limit active: ${devices.length} / ${result.devices.limit}`):t('Серверный лимит устройств выключен','Server device limit is disabled');
    dialog.innerHTML=`<div class="xm-sharing-shell"><header><div><span class="xm-sharing-kicker">ANTI-SHARING</span><h2>${esc(user.username)}</h2><p>${t('Объяснимый риск sharing без скрытого AI-решения','Explainable sharing risk without opaque AI decisions')}</p></div><button type="button" class="xm-sharing-close" aria-label="${t('Закрыть','Close')}">×</button></header><div class="xm-sharing-body"><section class="xm-sharing-score is-${result.tier.key}"><div><span>${t('Риск','Risk')}</span><strong>${result.score}</strong><b>${esc(result.tier.label)}</b></div><p>${esc(protection)}</p></section><div class="xm-sharing-grid"><section class="xm-sharing-panel"><div class="xm-sharing-panel-head"><h3>${t('Почему такой риск','Why this score')}</h3><span>${result.trafficAvailable?t('7 дней данных','7 days of data'):t('трафик недоступен','traffic unavailable')}</span></div><ul class="xm-sharing-reasons">${reasons}</ul><div class="xm-sharing-metrics"><div><span>${t('Трафик 24ч','Traffic 24h')}</span><b>${fmtBytes(result.traffic.recent24h)}</b></div><div><span>${t('Нод за 6ч','Nodes / 6h')}</span><b>${result.traffic.nodes6h}</b></div><div><span>${t('Новых устройств 24ч','New devices / 24h')}</span><b>${result.devices.new24h}</b></div></div></section><section class="xm-sharing-panel"><div class="xm-sharing-panel-head"><h3>${t('Устройства','Devices')}</h3><span>${devices.length}${result.devices.limit?' / '+result.devices.limit:''}</span></div><div class="xm-sharing-device-list">${deviceRows}</div></section></div><p class="xm-sharing-footnote">${t('Высокий объём трафика сам по себе не считается sharing. Балл растёт только при комбинации независимых сигналов.','High traffic volume alone is not treated as sharing. The score rises only when independent signals combine.')}</p></div></div>`;
    dialog.querySelector('.xm-sharing-close').onclick=()=>dialog.close();
    dialog.dataset.focus=focus||'';
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
