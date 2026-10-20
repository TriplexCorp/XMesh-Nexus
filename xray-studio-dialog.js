/* XRAY STUDIO / Full-screen contextual settings workspace.
   Moves existing form sections rather than cloning controls: existing element ids,
   validation, event handlers, and Server/Client JSON serializers are preserved. */
(()=>{
  'use strict';
  const view=document.getElementById('view');
  if(!view)return;

  const paths={
    security:{icon:'shield',title:'Защита соединения',detail:'Reality, TLS, сертификаты и ключи'},
    transport:{icon:'network',title:'Настройки транспорта',detail:'Параметры выбранного сетевого транспорта'},
    encryption:{icon:'lock',title:'VLESS Encryption',detail:'Шифрование и генерация ключей'},
    client:{icon:'settings',title:'Протокол и клиент',detail:'Клиентские параметры и дополнительные опции'}
  };
  const icons={
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    network:'<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v6m0 0-7 5m7-5 7 5"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M3 12h3m12 0h3M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/>'
  };
  const svg=(type)=>'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[type]+'</svg>';

  const attach=root=>{
    if(!root.classList.contains('studio-inline')||root.dataset.studioDrawer==='1')return;
    const basic=root.querySelector('#xpb-config-basic');
    const content=basic?.parentElement;
    const visual=root.querySelector('#xpb-visual-mode');
    const sections=Object.fromEntries(Object.keys(paths).map(key=>[key,root.querySelector('#xpb-config-'+key)]));
    if(!basic||!content||!visual||Object.values(sections).some(x=>!x))return;
    root.dataset.studioDrawer='1';
    root.classList.add('studio-drawer-layout');

    const launchers=document.createElement('section');
    launchers.className='sr-studio-launchers';
    launchers.setAttribute('aria-label','Дополнительные настройки подключения');
    launchers.innerHTML='<div class="sr-launchers-heading"><div><h3>Дополнительные настройки</h3><p>Откройте только нужный раздел. Конфигурация обновляется автоматически.</p></div><span class="sr-launchers-count"></span></div><div class="sr-launchers-grid"></div>';
    content.append(launchers);
    const grid=launchers.querySelector('.sr-launchers-grid');

    const dialog=document.createElement('dialog');
    dialog.className='sr-studio-dialog';
    dialog.setAttribute('aria-labelledby','sr-studio-dialog-title');
    dialog.setAttribute('aria-describedby','sr-studio-dialog-description');
    dialog.innerHTML='<div class="sr-dialog-shell">'+
      '<header class="sr-dialog-head"><div class="sr-dialog-heading"><p>XRAY STUDIO / НАСТРОЙКИ ПОДКЛЮЧЕНИЯ</p><h2 id="sr-studio-dialog-title">Параметры подключения</h2><span id="sr-studio-dialog-description">Настройки применяются к предпросмотру автоматически.</span></div><button type="button" class="sr-dialog-close" aria-label="Закрыть настройки">✕ <span>Закрыть</span></button></header>'+
      '<div class="sr-dialog-scroll" tabindex="-1"><div class="sr-dialog-inner"></div></div>'+
      '<footer class="sr-dialog-footer"><span>Изменения сразу отражаются в Server JSON и Client JSON.</span><button type="button" class="sr-dialog-done">Готово <span aria-hidden="true">✓</span></button></footer>'+
      '</div>';
    visual.append(dialog);
    const slot=dialog.querySelector('.sr-dialog-inner');
    Object.values(sections).forEach(panel=>slot.append(panel));

    let active=null;
    let returnFocus=null;
    const buttons={};
    for(const [key,entry] of Object.entries(paths)){
      const button=document.createElement('button');
      button.type='button';
      button.className='sr-studio-launch';
      button.dataset.panel=key;
      button.innerHTML='<span class="sr-launch-icon">'+svg(entry.icon)+'</span><span class="sr-launch-copy"><strong></strong><small></small></span><span class="sr-launch-chevron" aria-hidden="true">→</span>';
      button.querySelector('strong').textContent=entry.title;
      button.querySelector('small').textContent=entry.detail;
      button.addEventListener('click',()=>{
        if(button.hidden||sections[key].hidden)return;
        returnFocus=button;
        active=key;
        dialog.dataset.activePanel=key;
        dialog.querySelector('#sr-studio-dialog-title').textContent=button.querySelector('strong').textContent;
        dialog.querySelector('#sr-studio-dialog-description').textContent=button.querySelector('small').textContent;
        const scroller=dialog.querySelector('.sr-dialog-scroll');
        scroller.scrollTop=0;
        dialog.showModal();
        root.classList.add('sr-drawer-open');
        dialog.querySelector('.sr-dialog-close').focus();
      });
      buttons[key]=button;
      grid.append(button);
    }
    const close=()=>{if(dialog.open)dialog.close()};
    dialog.querySelector('.sr-dialog-close').addEventListener('click',close);
    dialog.querySelector('.sr-dialog-done').addEventListener('click',close);
    dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
    dialog.addEventListener('close',()=>{
      root.classList.remove('sr-drawer-open');
      dialog.removeAttribute('data-active-panel');
      active=null;
      if(returnFocus?.isConnected&&!returnFocus.hidden)returnFocus.focus();
      returnFocus=null;
    });
    const sync=()=>{
      const protocol=root.querySelector('#xpb-protocol')?.value||'';
      const network=root.querySelector('#xpb-network')?.value||'';
      const security=root.querySelector('#xpb-security')?.value||'';
      const descriptions={
        raw:'RAW / TCP',
        xhttp:'XHTTP',
        websocket:'WebSocket',
        grpc:'gRPC',
        httpupgrade:'HTTP Upgrade',
        mkcp:'mKCP',
        hysteria:'Hysteria',
        masque:'MASQUE',
        xdrive:'XDrive'
      };
      const secNames={tls:'TLS',reality:'Reality'};
      let available=0;
      for(const key of Object.keys(buttons)){
        const button=buttons[key];
        button.hidden=sections[key].hidden;
        if(!button.hidden)available++;
        const heading=button.querySelector('strong');
        const sub=button.querySelector('small');
        if(key==='security'){
          heading.textContent='Настройки '+(secNames[security]||'защиты');
          sub.textContent=security==='reality'?'Ключи, Short ID, SNI и целевой адрес':'Сертификаты, ALPN и версии TLS';
        }else if(key==='transport'){
          heading.textContent=network==='xhttp'?'Настройки XHTTP':'Настройки '+(descriptions[network]||'транспорта');
          sub.textContent=network==='xhttp'?'HTTP uplink, padding, xmux и серверные параметры':'Параметры '+(descriptions[network]||'выбранной сети');
        }else if(key==='encryption'){
          heading.textContent='VLESS Encryption';
          sub.textContent='Шифрование и генерация ключей VLESS';
        }else{
          heading.textContent='Протокол и клиент';
          sub.textContent='Учетные данные, '+(protocol.toUpperCase()||'протокол')+', совместимость и дополнительные поля';
        }
      }
      launchers.hidden=available===0;
      launchers.querySelector('.sr-launchers-count').textContent=available+' '+(available===1?'раздел':available>=2&&available<=4?'раздела':'разделов');
      if(active&&sections[active].hidden)close();
      if(dialog.open&&active){
        dialog.querySelector('#sr-studio-dialog-title').textContent=buttons[active].querySelector('strong').textContent;
        dialog.querySelector('#sr-studio-dialog-description').textContent=buttons[active].querySelector('small').textContent;
      }
    };
    // Existing per-field listeners run first and decide compatibility. Refresh
    // launchers on the next microtask, after those calculations have completed.
    root.addEventListener('input',()=>queueMicrotask(sync));
    root.addEventListener('change',()=>queueMicrotask(sync));
    for(const panel of Object.values(sections)){
      new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['hidden']});
    }
    root.querySelectorAll('[data-xray-mode]').forEach(modeButton=>
      modeButton.addEventListener('click',()=>{if(root.classList.contains('manual-mode'))close()})
    );
    sync();
  };

  const scan=()=>view.querySelectorAll('.xray-builder.studio-inline').forEach(attach);
  new MutationObserver(scan).observe(view,{childList:true,subtree:true});
  scan();
})();
