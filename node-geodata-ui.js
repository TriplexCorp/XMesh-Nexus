/* XMesh Nexus · Node GeoData workspace
 * An intentionally separate workflow from editing network/finance properties.
 * Saving persists only GeoData fields. Refresh requests are answered by the
 * autonomous node after it verifies the signed control-plane policy.
 */
window.XMeshNodeGeoData=(()=>{
'use strict';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal=value=>String(value??'').trim();
const HOUR_MIN=6,HOUR_MAX=168,MAX_CUSTOM=8,MAX_RULES=64;
const BASE_SITE='https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat';
const BASE_IP='https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat';
const icons={
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18M12 3c-5 5-5 13 0 18"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4Z"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 15.4-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.3L3 16M3 21v-5h5"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  check:'<path d="m20 6-11 11-5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert:'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6Z"/><path d="M14 2v5h5"/>'
};
const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icons[name]||icons.file)+'</svg>';
const geoProps=[
 'geoEnabled','geoBlockAds','geoUpdateHours','geoSiteUrl','geoIpUrl','geoExtraSources','geoCustomRules'
];

const urlCheck=(input,allowEmpty=true)=>{
  if(!input){if(allowEmpty)return;throw Error('Укажите HTTPS-источник.')}
  if(input.length>1024||input!==input.trim())throw Error('Адрес источника должен быть короче 1024 символов.');
  let address;
  try{address=new URL(input)}catch(_){throw Error('Некорректная HTTPS-ссылка.')}
  const host=address.hostname.toLowerCase();
  if(address.protocol!=='https:'||address.username||address.password||address.hash||(address.port&&address.port!=='443')||
      !host.includes('.')||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)||host.startsWith('[')){
    throw Error('Разрешены только публичные HTTPS-имена хостов на порту 443.');
  }
};
function read(form){
  const get=name=>form.elements.namedItem(name);
  return {
    geoEnabled:!!get('geoEnabled')?.checked,
    geoBlockAds:!!get('geoBlockAds')?.checked,
    geoUpdateHours:Number(get('geoUpdateHours')?.value),
    geoSiteUrl:normal(get('geoSiteUrl')?.value),
    geoIpUrl:normal(get('geoIpUrl')?.value),
    geoExtraSources:normal(get('geoExtraSources')?.value),
    geoCustomRules:normal(get('geoCustomRules')?.value)
  };
}
function validate(config){
  if(!config.geoEnabled)return;
  if(!Number.isInteger(config.geoUpdateHours)||config.geoUpdateHours<HOUR_MIN||config.geoUpdateHours>HOUR_MAX){
    throw Error('Интервал автоматической проверки — от 6 до 168 часов.');
  }
  urlCheck(config.geoSiteUrl);
  urlCheck(config.geoIpUrl);
  const names=new Set(['geosite.dat','geoip.dat']);
  const lines=config.geoExtraSources.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(lines.length>MAX_CUSTOM)throw Error('Допустимо максимум 8 дополнительных .dat-файлов.');
  for(const line of lines){
    const parts=line.split(/\s+/);
    if(parts.length<2||parts.length>3||!/^[A-Za-z0-9_-]{1,48}\.dat$/.test(parts[0])){
      throw Error('Формат дополнительного источника: имя.dat HTTPS_URL [SHA256].');
    }
    if(names.has(parts[0]))throw Error('Повторяется имя GeoData-файла: '+parts[0]);
    names.add(parts[0]);
    urlCheck(parts[1],false);
    if(parts[2]&&!/^[a-fA-F0-9]{64}$/.test(parts[2]))throw Error('Некорректная SHA-256 для '+parts[0]);
  }
  const rules=config.geoCustomRules.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(rules.length>MAX_RULES)throw Error('Не больше 64 правил маршрутизации на одну ноду.');
  for(const rule of rules){
    if(!/^(?:geosite|geoip|ext):[A-Za-z0-9_:.-]+\s*=>\s*(?:block|direct)$/.test(rule)){
      throw Error('Правило должно выглядеть как geosite:category-ads-all => block.');
    }
  }
}
function snapshot(node){
  return {
    geoEnabled:node.geoEnabled===true,
    geoBlockAds:node.geoBlockAds!==false,
    geoUpdateHours:node.geoUpdateHours??24,
    geoSiteUrl:node.geoSiteUrl||'',
    geoIpUrl:node.geoIpUrl||'',
    geoExtraSources:node.geoExtraSources||'',
    geoCustomRules:node.geoCustomRules||''
  };
}
function markup(node){
  const data=snapshot(node);
  const selected=(value)=>value?'checked':'';
  return '<div class="geo-workspace">'+
    '<header class="geo-head">'+
      '<div class="geo-head-icon">'+icon('globe')+'</div>'+
      '<div class="geo-head-copy"><span class="geo-eyebrow">XMESH / NODE SERVICES</span><h2>GeoData</h2>'+
      '<p>'+escapeHtml(node.name||'Узел')+' <span aria-hidden="true">·</span> '+escapeHtml(node.addr||'Адрес не указан')+'</p></div>'+
      '<button type="button" class="geo-close" data-x aria-label="Закрыть окно GeoData">'+icon('x')+'</button>'+
    '</header>'+
    '<div class="geo-state-strip" aria-live="polite">'+
      '<div class="geo-state-cell"><span>Состояние</span><strong data-geo-state>Получение данных…</strong></div>'+
      '<div class="geo-state-cell"><span>Установленные файлы</span><strong data-geo-files>—</strong></div>'+
      '<div class="geo-state-cell"><span>Последняя проверка</span><strong data-geo-last>—</strong></div>'+
    '</div>'+
    '<form class="geo-form" data-geo-form data-geo-id="'+escapeHtml(node.id)+'" novalidate>'+
      '<div class="geo-columns">'+
        '<section class="geo-panel geo-primary">'+
          '<div class="geo-section-title"><span class="geo-section-icon">'+icon('shield')+'</span><div><h3>Защита и обновления</h3><p>Быстрые настройки сервера</p></div></div>'+
          '<label class="geo-switch-row"><span class="geo-switch-copy"><strong>Использовать GeoData</strong><small>Геоданные и маршрутизация на этой ноде</small></span>'+
             '<input name="geoEnabled" type="checkbox" '+selected(data.geoEnabled)+'><span class="geo-switch" aria-hidden="true"></span></label>'+
          '<label class="geo-switch-row"><span class="geo-switch-copy"><strong>Блокировка рекламы</strong><small>geosite:category-ads-all → blackhole</small></span>'+
             '<input name="geoBlockAds" type="checkbox" '+selected(data.geoBlockAds)+'><span class="geo-switch" aria-hidden="true"></span></label>'+
          '<label class="geo-inline-control"><span><strong>Автоматическое обновление</strong><small>Как часто нода проверяет источники</small></span>'+
             '<span class="geo-hour-field"><input type="number" name="geoUpdateHours" min="6" max="168" step="1" value="'+escapeHtml(data.geoUpdateHours)+'" aria-label="Интервал обновления в часах"><span>ч</span></span></label>'+
          '<div class="geo-divider"></div>'+
          '<div class="geo-section-title geo-subtitle"><span class="geo-section-icon">'+icon('link')+'</span><div><h3>Источники GeoData</h3><p>Нода скачивает файлы напрямую по HTTPS</p></div></div>'+
          '<label class="geo-field"><span>GeoSite <small>geosite.dat</small></span><input type="url" name="geoSiteUrl" spellcheck="false" autocomplete="off" placeholder="'+escapeHtml(BASE_SITE)+'" value="'+escapeHtml(data.geoSiteUrl)+'"><small>Пустое поле — стандартный источник</small></label>'+
          '<label class="geo-field"><span>GeoIP <small>geoip.dat</small></span><input type="url" name="geoIpUrl" spellcheck="false" autocomplete="off" placeholder="'+escapeHtml(BASE_IP)+'" value="'+escapeHtml(data.geoIpUrl)+'"><small>Пустое поле — стандартный источник</small></label>'+
        '</section>'+
        '<section class="geo-panel geo-secondary">'+
          '<div class="geo-section-title"><span class="geo-section-icon">'+icon('edit')+'</span><div><h3>Пользовательская маршрутизация</h3><p>Дополнительные файлы и правила на одной ноде</p></div></div>'+
          '<label class="geo-field"><span>Правила routing <small>до 64</small></span>'+
            '<textarea name="geoCustomRules" rows="5" spellcheck="false" placeholder="geosite:category-ads-all => block&#10;geoip:private => direct">'+escapeHtml(data.geoCustomRules)+'</textarea>'+
            '<small>Одно правило на строку. Допустимые действия: block и direct.</small></label>'+
          '<label class="geo-field"><span>Дополнительные .dat-файлы <small>до 8</small></span>'+
            '<textarea name="geoExtraSources" rows="4" spellcheck="false" placeholder="custom.dat https://example.com/custom.dat">'+escapeHtml(data.geoExtraSources)+'</textarea>'+
            '<small>Формат: имя.dat HTTPS_URL [SHA-256]</small></label>'+
          '<div class="geo-dataset-list" data-geo-dataset-list><span>После первой синхронизации здесь появятся файлы и контрольные суммы.</span></div>'+
        '</section>'+
      '</div>'+
      '<footer class="geo-foot">'+
        '<div class="geo-feedback" role="status" aria-live="polite" data-geo-feedback>Изменения затронут только этот узел.</div>'+
        '<div class="geo-actions">'+
          '<button type="button" class="geo-btn geo-btn-secondary" data-x>Закрыть</button>'+
          '<button type="submit" class="geo-btn geo-btn-save" data-geo-save>'+icon('check')+'Сохранить</button>'+
          '<button type="button" class="geo-btn geo-btn-refresh" data-geo-refresh>'+icon('refresh')+'Обновить GeoData</button>'+
        '</div>'+
      '</footer>'+
    '</form>'+
  '</div>';
}

const STATE_NAMES={
  current:'Актуально', pending:'Применяется', error:'Ошибка обновления',
  rolled_back:'Выполнен откат'
};
function displayStatus(form,runtime,node){
  if(!form?.isConnected)return;
  const data=runtime?.connected?runtime?.geoData:null;
  const status=normal(data?.state);
  const hasAgent=Boolean(runtime?.connected);
  const stateEl=form.closest('.geo-workspace')?.querySelector('[data-geo-state]');
  const filesEl=form.closest('.geo-workspace')?.querySelector('[data-geo-files]');
  const timeEl=form.closest('.geo-workspace')?.querySelector('[data-geo-last]');
  const listEl=form.querySelector('[data-geo-dataset-list]');
  const count=data?.files&&typeof data.files==='object'?Object.keys(data.files).length:0;
  const label=!node.geoEnabled?'Отключено':!hasAgent?'Нет связи с агентом':STATE_NAMES[status]||'Ожидаем загрузку';
  if(stateEl){stateEl.textContent=label;stateEl.dataset.geoState=status||(!hasAgent?'offline':'waiting');}
  if(filesEl)filesEl.textContent=count?count+' файл(ов)':'Нет данных';
  const stamp=Number(data?.checkedAt);
  if(timeEl)timeEl.textContent=Number.isSafeInteger(stamp)&&stamp>0?
    new Date(stamp*1000).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Не проверялись';
  if(listEl){
    const files=data?.files&&typeof data.files==='object'?Object.entries(data.files):[];
    listEl.innerHTML=files.length?
      '<div class="geo-dataset-head"><strong>Файлы на ноде</strong><small>SHA-256</small></div>'+
      files.map(([name,sha])=>'<div class="geo-dataset"><span>'+icon('file')+escapeHtml(name)+'</span><code>'+escapeHtml(String(sha).slice(0,14))+'…</code></div>').join(''):
      '<span>'+(node.geoEnabled?'Нода ещё не сообщила об установленных файлах.':'Включите GeoData, чтобы нода начала загрузку.')+'</span>';
    if(data?.lastError){
      const error=document.createElement('p');
      error.className='geo-node-error';error.textContent=String(data.lastError).slice(0,220);
      listEl.append(error);
    }
  }
}

function feedback(form,message,kind='neutral'){
  const el=form?.querySelector('[data-geo-feedback]');
  if(el){el.textContent=message;el.dataset.kind=kind;}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function open({node,modal,apiRequest,updateNode,notify,afterSave}){
  if(!node||!Number.isSafeInteger(Number(node.id))||Number(node.id)<=0){
    notify?.('Некорректный узел.');return;
  }
  modal(markup(node),'node-geodata-dialog');
  const form=document.querySelector('dialog#dlg [data-geo-form]');
  if(!form)return;
  const saveButton=form.querySelector('[data-geo-save]');
  const refreshButton=form.querySelector('[data-geo-refresh]');
  let busy=false,dirty=false,runtime=null;
  const updateControls=()=>{
    const values=read(form);
    form.dataset.geoEnabled=values.geoEnabled?'1':'0';
    saveButton.disabled=busy;
    refreshButton.disabled=busy||!values.geoEnabled||node.disabled===true;
    if(dirty&&!busy)feedback(form,'Есть несохранённые изменения','dirty');
  };
  const loadRuntime=async()=>{
    try{
      const result=await apiRequest('/api/v1/nodes/'+encodeURIComponent(node.id)+'/runtime');
      runtime=result;
      if(form.isConnected)displayStatus(form,result,node);
      return result;
    }catch(error){
      if(form.isConnected&&!dirty)feedback(form,'Не удалось прочитать статус агента: '+(error.message||'API'),'warning');
      return null;
    }
  };
  form.addEventListener('input',()=>{dirty=true;updateControls();});
  form.addEventListener('change',()=>{dirty=true;updateControls();});
  const persist=async()=>{
    const payload=read(form);
    validate(payload);
    busy=true;updateControls();
    feedback(form,'Сохраняю настройки на сервере…','loading');
    try{
      const updated=await updateNode(Object.fromEntries(geoProps.map(key=>[key,payload[key]])));
      Object.assign(node,updated||payload);
      dirty=false;
      feedback(form,'Настройки сохранены. Нода получит изменения при ближайшей синхронизации.','success');
      afterSave?.();
      return true;
    }catch(error){
      feedback(form,'Не удалось сохранить: '+(error.message||'ошибка API'),'error');
      return false;
    }finally{
      busy=false;updateControls();
    }
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy)return;
    await persist();
  });
  refreshButton.addEventListener('click',async()=>{
    if(busy||node.disabled)return;
    if(dirty){
      const saved=await persist();
      if(!saved)return;
    }
    if(!read(form).geoEnabled){
      feedback(form,'Сначала включите GeoData и сохраните настройки.','warning');return;
    }
    if(runtime?.connected&&runtime.version&&/^control-v(?:[0-3]\.|4\.0\.)/.test(String(runtime.version))){
      feedback(form,'Требуется обновить управляющий Agent до версии 4.1 или новее.','warning');
      return;
    }
    busy=true;updateControls();
    feedback(form,'Отправляю запрос на внеочередное обновление…','loading');
    try{
      const request=await apiRequest('/api/v1/nodes/'+encodeURIComponent(node.id)+'/geodata/refresh',{
        method:'POST',body:JSON.stringify({})
      });
      const revision=Number(request.refreshRevision);
      if(!Number.isSafeInteger(revision)||revision<=0)throw Error('Панель вернула некорректную ревизию.');
      node.geoRefreshRevision=revision;
      feedback(form,'Запрос принят. Нода самостоятельно скачает и проверит GeoData.','loading');
      const deadline=Date.now()+90000;
      while(Date.now()<deadline&&form.isConnected&&document.querySelector('dialog#dlg')?.open){
        await sleep(3000);
        if(!form.isConnected)break;
        const observed=await loadRuntime();
        const geo=observed?.connected?observed.geoData:null;
        if(Number(geo?.refreshRevision)<revision)continue;
        if(geo?.state==='current'){
          feedback(form,'GeoData обновлены и подтверждены управляющим агентом.','success');
          notify?.('GeoData обновлены на '+(node.name||'узле'));
          return;
        }
        if(geo?.state==='error'||geo?.state==='rolled_back'){
          feedback(form,'Обновление не применено: '+(geo?.lastError||'проверьте журнал агента'),'error');
          return;
        }
      }
      if(form.isConnected){
        feedback(form,'Запрос сохранён, но нода пока не подтвердила его выполнение. Проверьте статус позже.','warning');
      }
    }catch(error){
      feedback(form,'Не удалось обновить GeoData: '+(error.message||'ошибка API'),'error');
    }finally{
      busy=false;
      if(form.isConnected)updateControls();
    }
  });
  updateControls();
  void loadRuntime();
}
return {open,read,validate};
})();
