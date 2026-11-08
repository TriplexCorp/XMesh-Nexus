/* Build provenance + owner-confirmed update from the fixed systemd updater. */
(() => {
  'use strict';
  const root=document.getElementById('top-panel-version');
  if(!root)return;
  const trigger=root.querySelector('[data-panel-version-trigger]');
  const menu=root.querySelector('[data-panel-version-menu]');
  const heading=root.querySelector('[data-panel-version-heading]');
  const version=root.querySelector('[data-panel-version-number]');
  const revision=root.querySelector('[data-panel-version-revision]');
  const check=root.querySelector('[data-panel-version-check]');
  const status=root.querySelector('[data-panel-version-status]');
  const update=root.querySelector('[data-panel-version-update]');
  const updateStatus=root.querySelector('[data-panel-version-update-status]');
  const reload=root.querySelector('[data-panel-version-reload]');
  const settings=root.querySelector('[data-panel-version-settings]');
  const caption=root.querySelector('[data-panel-version-caption]');

  let owner=false,installed=null,checked=null,checking=false,open=false;
  let systemState=null,systemError='',requesting=false,readingState=false,watch=null;
  const labels={
    ru:{
      title:'Версия панели',check:'Проверить обновления',checking:'Проверка GitHub…',
      waiting:'Проверка сравнивает установленную сборку с main.',
      up_to_date:'Установлена актуальная сборка.',update_available:'Доступно обновление панели.',
      local_ahead:'Установленная сборка новее текущей ветки main.',
      unknown_revision:'Ревизия этой сборки неизвестна — сравнение недоступно.',
      unverifiable:'Ветки различаются или сравнение недоступно. Нужна ручная проверка.',
      unavailable:'Не удалось связаться с GitHub. Актуальность не подтверждена.',
      settings:'Другие способы обновления',noRevision:'Ревизия сборки неизвестна',
      readOnly:'Проверка и запуск обновления доступны владельцу панели.',
      update:'Обновить панель',updating:'Запуск обновления…',
      reload:'Перезагрузить страницу',idle:'Системный updater готов к запросу.',
      queued:'Запрос принят в очередь системного updater.',running:'Обновление выполняется на сервере. Связь может прерваться.',
      success:'Системный updater завершил работу. Перезагрузите страницу и проверьте новую сборку.',
      failed:'Ошибка установки. Проверьте системный журнал обновления.',
      updaterUnavailable:'Системный updater недоступен. Проверьте xmesh-panel-update.path на хосте.',
      reconnect:'Нет связи с API во время обновления. Повторная проверка будет выполнена автоматически.'
    },
    en:{
      title:'Panel version',check:'Check for updates',checking:'Checking GitHub…',
      waiting:'The installed build is compared against main.',
      up_to_date:'This build is up to date.',update_available:'A panel update is available.',
      local_ahead:'The installed build is ahead of upstream main.',
      unknown_revision:'This build has no revision identifier; comparison is unavailable.',
      unverifiable:'Branches differ or cannot be compared. Check manually.',
      unavailable:'GitHub could not be reached. Update status is unverified.',
      settings:'Other update options',noRevision:'Build revision unavailable',
      readOnly:'Only the owner can check for and install updates.',
      update:'Update panel',updating:'Queueing update…',
      reload:'Reload page',idle:'System updater is ready.',
      queued:'Update request queued for the host updater.',running:'Update running on the host. Connection may be interrupted.',
      success:'The host updater finished. Reload to verify the installed build.',
      failed:'Update failed. Inspect the host updater logs.',
      updaterUnavailable:'Host updater is unavailable. Check xmesh-panel-update.path.',
      reconnect:'Cannot reach the API during the update. Status will be checked again.'
    }
  };
  const locale=()=>window.XMeshI18n?.getLanguage?.()==='en'?'en':'ru';
  const t=()=>labels[locale()];
  const short=sha=>typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)?sha.slice(0,8):null;
  const active=()=>systemState?.status==='queued'||systemState?.status==='running';
  function stopWatch(){
    if(watch!==null){clearInterval(watch);watch=null}
  }
  function watchProgress(){
    stopWatch();
    if(!open||!owner||!active())return;
    watch=setInterval(()=>{
      if(!document.hidden)void loadUpdateState();
    },5000);
  }
  function render(){
    const words=t(),build=installed?.version||'—',sha=short(installed?.revision);
    version.textContent='Nexus v'+build;
    heading.textContent=words.title;
    trigger.setAttribute('aria-label',words.title+': '+build);
    trigger.title=words.title+': '+build;
    revision.textContent=sha?'Build '+sha:words.noRevision;
    revision.title=sha?installed.revision:words.noRevision;
    check.textContent=checking?words.checking:words.check;
    check.disabled=checking||requesting;
    check.hidden=!owner;
    caption.textContent=owner?words.waiting:words.readOnly;
    status.textContent=checked?(words[checked.status]||words.unverifiable):'';
    status.dataset.state=checked?.status||'idle';
    const latest=short(checked?.latest_revision);
    status.title=latest?'main '+latest:'';
    const available=owner&&checked?.status==='update_available';
    update.hidden=!available;
    update.disabled=requesting||checking||readingState||active()||systemState?.status==='unavailable'||systemState===null;
    update.textContent=requesting?words.updating:words.update;
    const state=systemState?.status;
    updateStatus.textContent=owner?(systemError||(
      state==='unavailable'?words.updaterUnavailable:words[state]||''
    )):'';
    updateStatus.dataset.state=state||'idle';
    reload.hidden=!owner||state!=='success';
    reload.textContent=words.reload;
    settings.textContent=words.settings;
    settings.hidden=!available;
    root.dataset.updateAvailable=available?'true':'false';
  }
  function toggle(next){
    open=Boolean(next);
    menu.hidden=!open;
    trigger.setAttribute('aria-expanded',String(open));
    if(open){
      render();
      if(owner)void loadUpdateState();
    }else{
      stopWatch();
    }
  }
  async function getJSON(path){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Request failed: '+response.status);
    return response.json();
  }
  async function init(user){
    stopWatch();
    owner=user?.role==='owner';
    installed=null;checked=null;systemState=null;systemError='';
    requesting=false;checking=false;readingState=false;
    root.hidden=false;
    render();
    try{
      const result=await getJSON('/api/v1/panel/version');
      if(result&&typeof result.version==='string'&&/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(result.version))installed=result;
      else checked={status:'unavailable'};
    }catch(_){
      checked={status:'unavailable'};
    }
    render();
    if(open&&owner)void loadUpdateState();
  }
  async function loadUpdateState(){
    if(!owner||readingState)return;
    const bridge=window.XMeshPanelUpdater;
    if(!bridge?.status){
      systemState={status:'unavailable'};
      render();
      return;
    }
    readingState=true;
    try{
      const result=await bridge.status();
      systemState=result&&typeof result.status==='string'?result:{status:'unavailable'};
      systemError='';
    }catch(error){
      // The active updater can restart the API: do not misreport it as failed.
      if(!active())systemState={status:'unavailable'};
      systemError=active()?t().reconnect:(error.message||t().updaterUnavailable);
    }finally{
      readingState=false;
      render();
      watchProgress();
    }
  }
  async function checkUpdates(){
    if(!owner||checking||requesting)return;
    checking=true;checked=null;render();
    try{
      const result=await getJSON('/api/v1/panel/version/check');
      checked=result&&typeof result.status==='string'?result:{status:'unavailable'};
    }catch(_){
      checked={status:'unavailable'};
    }finally{
      checking=false;
      render();
      await loadUpdateState();
    }
  }
  async function requestUpdate(){
    if(!owner||requesting||checking||checked?.status!=='update_available'
      ||readingState||active()||systemState?.status==='unavailable'||!systemState)return;
    const bridge=window.XMeshPanelUpdater;
    if(!bridge?.request)return;
    requesting=true;systemError='';render();
    try{
      const result=await bridge.request();
      if(!result?.cancelled){
        // HTTP 202 means queued, NOT installed. Only the host status endpoint
        // can report success. Never claim deployment on a POST response.
        systemState={status:'queued'};
        watchProgress();
        void loadUpdateState();
      }
    }catch(error){
      systemError=error.message||t().failed;
    }finally{
      requesting=false;render();
    }
  }
  trigger.addEventListener('click',()=>toggle(!open));
  check.addEventListener('click',()=>{void checkUpdates()});
  update.addEventListener('click',()=>{void requestUpdate()});
  reload.addEventListener('click',()=>location.reload());
  settings.addEventListener('click',event=>{
    event.preventDefault();
    toggle(false);
    location.hash='set/system';
    window.setTimeout(()=>document.getElementById('panel-update-card')?.scrollIntoView({behavior:'smooth',block:'center'}),120);
  });
  document.addEventListener('click',event=>{if(open&&!root.contains(event.target))toggle(false)});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&open){toggle(false);trigger.focus()}
  });
  document.addEventListener('xmesh:locale-changed',render);
  window.XMeshPanelVersion={init};
})();
