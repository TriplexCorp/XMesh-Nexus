/* Read-only panel build metadata + explicit owner-only upstream check. */
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
  const settings=root.querySelector('[data-panel-version-settings]');
  const caption=root.querySelector('[data-panel-version-caption]');

  let owner=false,installed=null,checked=null,checking=false,open=false;
  const labels={
    ru:{
      title:'Версия панели',check:'Проверить обновления',checking:'Проверка GitHub…',
      waiting:'Нажмите «Проверить обновления», чтобы сравнить сборку с main.',
      up_to_date:'Установлена актуальная сборка.',update_available:'Доступно обновление панели.',
      local_ahead:'Установленная сборка новее текущей ветки main.',
      unknown_revision:'Ревизия этой сборки неизвестна — сравнение недоступно.',
      unverifiable:'Ветки различаются или сравнение недоступно. Нужна ручная проверка.',
      unavailable:'Не удалось связаться с GitHub. Актуальность не подтверждена.',
      settings:'Открыть обновление в настройках',noRevision:'Ревизия сборки неизвестна',
      readOnly:'Проверка обновлений доступна владельцу панели.'
    },
    en:{
      title:'Panel version',check:'Check for updates',checking:'Checking GitHub…',
      waiting:'Select “Check for updates” to compare your build with main.',
      up_to_date:'This build is up to date.',update_available:'A panel update is available.',
      local_ahead:'The installed build is ahead of upstream main.',
      unknown_revision:'This build has no revision identifier; comparison is unavailable.',
      unverifiable:'Branches differ or cannot be compared. Check manually.',
      unavailable:'GitHub could not be reached. Update status is unverified.',
      settings:'Open update settings',noRevision:'Build revision unavailable',
      readOnly:'Only the panel owner can check for updates.'
    }
  };
  const locale=()=>window.XMeshI18n?.getLanguage?.()==='en'?'en':'ru';
  const t=()=>labels[locale()];
  const short=sha=>typeof sha==='string'&&/^[a-f0-9]{40}$/.test(sha)?sha.slice(0,8):null;

  function render(){
    const words=t(),build=installed?.version||'—',sha=short(installed?.revision);
    version.textContent='Nexus v'+build;
    heading.textContent=words.title;
    trigger.setAttribute('aria-label',words.title+': '+build);
    trigger.title=words.title+': '+build;
    revision.textContent=sha?'Build '+sha:words.noRevision;
    revision.title=sha?installed.revision:words.noRevision;
    check.textContent=checking?words.checking:words.check;
    check.disabled=checking;
    check.hidden=!owner;
    caption.textContent=owner?words.waiting:words.readOnly;
    status.textContent=checked?(words[checked.status]||words.unverifiable):'';
    status.dataset.state=checked?.status||'idle';
    const latest=short(checked?.latest_revision);
    status.title=latest?'main '+latest:'';
    settings.textContent=words.settings;
    settings.hidden=!owner||checked?.status!=='update_available';
    root.dataset.updateAvailable=checked?.status==='update_available'?'true':'false';
  }
  function toggle(next){
    open=Boolean(next);
    menu.hidden=!open;
    trigger.setAttribute('aria-expanded',String(open));
    if(open)render();
  }
  async function getJSON(path){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Request failed: '+response.status);
    return response.json();
  }
  async function init(user){
    owner=user?.role==='owner';
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
  }
  async function checkUpdates(){
    if(!owner||checking)return;
    checking=true;
    checked=null;
    render();
    try{
      const result=await getJSON('/api/v1/panel/version/check');
      checked=result&&typeof result.status==='string'?result:{status:'unavailable'};
    }catch(_){
      checked={status:'unavailable'};
    }finally{
      checking=false;
      render();
    }
  }
  trigger.addEventListener('click',()=>toggle(!open));
  check.addEventListener('click',()=>{void checkUpdates()});
  settings.addEventListener('click',event=>{
    event.preventDefault();
    toggle(false);
    location.hash='set';
    window.setTimeout(()=>document.getElementById('panel-update-card')?.scrollIntoView({behavior:'smooth',block:'center'}),120);
  });
  document.addEventListener('click',event=>{if(open&&!root.contains(event.target))toggle(false)});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&open){toggle(false);trigger.focus()}
  });
  // Listen to the app's explicit locale event: watching <html lang> causes
  // a feedback loop with the global i18n translator's DOM mutation handler.
  document.addEventListener('xmesh:locale-changed',render);
  window.XMeshPanelVersion={init};
})();
