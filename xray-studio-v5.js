/* XRAY STUDIO reference UI v5. Progressive enhancement of existing real controls. */
(()=>{
 'use strict';
 const svg=(paths)=>'<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
 const icons={
   layers:svg('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>'),
   tag:svg('<path d="M20 12V5a2 2 0 0 0-2-2h-7L3 11a2 2 0 0 0 0 3l7 7a2 2 0 0 0 3 0l8-8a2 2 0 0 0-1-1Z"/><circle cx="16.3" cy="7.8" r="1"/>'),
   link:svg('<path d="M10 13a5 5 0 0 0 7 .5l3-3A5 5 0 0 0 13 3l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7-.5l-3 3A5 5 0 0 0 11 21l1.7-1.7"/>'),
   monitor:svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
   port:svg('<rect x="4" y="3" width="16" height="5" rx="1.5"/><rect x="4" y="10" width="16" height="5" rx="1.5"/><rect x="4" y="17" width="16" height="5" rx="1.5"/>'),
   network:svg('<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v6m0 0-7 5m7-5 7 5"/>'),
   shield:svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v8"/>'),
   gear:svg('<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M20 13.5v-3l-2.2-.7-.9-2.1 1-2-2.2-2.2-2 1-2.1-.9L11 1.5H8l-.7 2.2-2.1.9-2-1L1 5.8l1 2-.9 2.1L-1 10.5v3l2.2.7.9 2.1-1 2 2.2 2.2 2-1 2.1.9.7 2.2h3l.7-2.2 2.1-.9 2 1 2.2-2.2-1-2 .9-2.1Z" transform="translate(2 0) scale(.84)"/>'),
   info:svg('<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>'),
   brace:svg('<path d="M8 3H6a2 2 0 0 0-2 2v4c0 2-1 3-3 3 2 0 3 1 3 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4c0 2 1 3 3 3-2 0-3 1-3 3v4a2 2 0 0 1-2 2h-2"/>'),
   maximize:svg('<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>')
 };
 const escapeSelector=(value)=>value.replace(/[^a-z0-9_-]/gi,'');
 function apply(root){
   if(!root || root.dataset.studioReferenceV5==='1')return;
   root.dataset.studioReferenceV5='1';
   root.classList.add('studio-reference-v5');
   const tabrow=root.querySelector('.xray-config-tabs');
   const layout=root.querySelector('.xray-workspace-layout');
   const footer=root.querySelector('.xray-footer');
   if(tabrow && layout && tabrow.parentElement!==root)root.insertBefore(tabrow,layout);
   if(footer && footer.parentElement!==root)root.append(footer);

   const steps={
     basic:['Основное','Базовые параметры'],
     security:['Защита','TLS и Reality'],
     transport:['Транспорт','Сетевой транспорт'],
     encryption:['VLESS Encryption','Параметры шифрования'],
     client:['Протокол и клиент','Дополнительные настройки']
   };
   root.querySelectorAll('[data-xray-config-tab]').forEach(button=>{
     const values=steps[button.dataset.xrayConfigTab];
     const label=button.querySelector('b');
     if(values && label){
       label.textContent='';
       const strong=document.createElement('strong');
       strong.textContent=values[0];
       const small=document.createElement('small');
       small.textContent=values[1];
       label.append(strong,small);
     }
   });

   function adorn(field,icon,help){
     if(!field || field.querySelector('.sr-v5-input'))return;
     const control=field.querySelector('input,select');
     if(!control)return;
     const wrapper=document.createElement('span');
     wrapper.className='sr-v5-input';
     const symbol=document.createElement('span');
     symbol.className='sr-v5-icon';
     symbol.innerHTML=icons[icon]||icons.layers;
     control.parentNode.insertBefore(wrapper,control);
     wrapper.append(symbol,control);
     if(help && !field.querySelector(':scope > small')){
       const hint=document.createElement('small');
       hint.className='sr-v5-hint';
       hint.textContent=help;
       field.append(hint);
     }
   }
   const meta=root.querySelector('.xray-meta-grid');
   if(meta){
     [...meta.children].forEach((field,index)=>{
       adorn(field,['layers','tag','link'][index]);
     });
     const last=meta.lastElementChild;
     if(last && !last.querySelector('.sr-v5-meta-hint')){
       const hint=document.createElement('small');
       hint.className='sr-v5-meta-hint';
       hint.textContent='Этот адрес будет указан в клиентской конфигурации';
       last.append(hint);
     }
   }
   const basic=root.querySelector('#xpb-config-basic');
   if(basic){
     const fieldIcons=['monitor','port','layers','network','shield'];
     const hints=[
       'На каком адресе будут приниматься подключения',
       'Порт для входящих подключений',
       'Протокол входящего соединения',
       'Тип сетевого транспорта',
       'Метод защиты соединения'
     ];
     basic.querySelectorAll('.xray-main-grid > .f').forEach((field,index)=>{
       adorn(field,fieldIcons[index],hints[index]);
     });
     const title=basic.querySelector('.xray-config-panel-title');
     if(title){
       const mark=document.createElement('span');
       mark.className='sr-v5-heading-icon';
       mark.innerHTML=icons.gear;
       title.prepend(mark);
       const badge=title.querySelector('.xray-config-required');
       if(badge)badge.hidden=true;
       const help=document.createElement('button');
       help.type='button';
       help.className='sr-v5-help';
       help.innerHTML=icons.info+'<span>Как это работает?</span>';
       help.addEventListener('click',()=>{
         const tip=basic.querySelector('.studio-v3-tip');
         if(tip)tip.scrollIntoView({behavior:'smooth',block:'nearest'});
       });
       title.append(help);
     }
     const tip=basic.querySelector('.studio-v3-tip');
     if(tip){
       const icon=tip.querySelector('.studio-v3-tip-icon');
       if(icon)icon.innerHTML=icons.info;
     }
   }
   const previewTitle=root.querySelector('.xray-output-workspace-head b');
   if(previewTitle)previewTitle.textContent='JSON предпросмотр';
   const previewEyebrow=root.querySelector('.xray-output-workspace-head .note');
   if(previewEyebrow)previewEyebrow.innerHTML=icons.brace;
   const previewDesc=root.querySelector('.xray-output-workspace-head small');
   if(previewDesc)previewDesc.textContent='Конфигурация обновляется автоматически при изменении параметров.';

   // A genuinely functional expansion control for both Server and Client previews.
   const toolbar=root.querySelector('.xray-output-toolbar');
   if(toolbar){
     const expand=document.createElement('button');
     expand.type='button';expand.className='sr-v5-expand';
     expand.setAttribute('aria-expanded','false');
     expand.setAttribute('aria-label','Развернуть предпросмотр JSON');
     expand.title='Развернуть JSON';
     expand.innerHTML=icons.maximize;
     expand.addEventListener('click',()=>{
       const expanded=root.classList.toggle('sr-v5-expanded');
       expand.setAttribute('aria-expanded',String(expanded));
       expand.title=expanded?'Свернуть JSON':'Развернуть JSON';
       expand.setAttribute('aria-label',expand.title);
     });
     toolbar.append(expand);
   }

   // Ruler mirrors the real textarea's number of lines and scroll position.
   root.querySelectorAll('.xray-output-pane .xray-code-view').forEach(view=>{
     if(view.classList.contains('xray-custom-code-view'))return;
     const textarea=view.querySelector('textarea');
     const syntax=view.querySelector('pre');
     if(!textarea || !syntax)return;
     const gutter=document.createElement('div');
     gutter.className='sr-v5-gutter';
     gutter.setAttribute('aria-hidden','true');
     const numbers=document.createElement('div');
     numbers.className='sr-v5-gutter-lines';
     gutter.append(numbers);
     view.append(gutter);
     let previous=-1;
     const refresh=()=>{
       const count=Math.min(2000,Math.max(1,textarea.value.split('\n').length));
       if(count===previous)return;
       previous=count;
       const fragment=document.createDocumentFragment();
       for(let i=1;i<=count;i++){
         const n=document.createElement('span');
         n.textContent=i;
         fragment.append(n);
       }
       numbers.replaceChildren(fragment);
     };
     textarea.addEventListener('scroll',()=>{
       numbers.style.transform='translateY('+(-textarea.scrollTop)+'px)';
     },{passive:true});
     const observer=new MutationObserver(refresh);
     observer.observe(syntax,{childList:true,subtree:true,characterData:true});
     refresh();
   });

   if(footer){
     const summary=document.createElement('div');
     summary.className='sr-v5-save-label';
     summary.innerHTML='<span class="sr-v5-save-check" aria-hidden="true">✓</span><span><strong>Проверьте настройки</strong><small>Затем сохраните профиль в коллекцию</small></span>';
     footer.prepend(summary);
     const save=footer.querySelector('#xpb-save');
     if(save)save.textContent='▣  Сохранить профиль';
     const inputs=[...root.querySelectorAll('[id^="xpb-"] input,[id^="xpb-"] select')];
     const snapshot=inputs.map(el=>({el,value:el.value,checked:el.checked}));
     const reset=document.createElement('button');
     reset.type='button';reset.className='sr-v5-reset';
     reset.textContent='↶  Сбросить';
     reset.addEventListener('click',()=>{
       if(!window.confirm('Вернуть значения полей к состоянию при открытии конструктора? Несохранённые изменения будут потеряны.'))return;
       snapshot.forEach(item=>{
         if(!item.el.isConnected)return;
         item.el.value=item.value;
         if(item.el.type==='checkbox')item.el.checked=item.checked;
         item.el.dispatchEvent(new Event('input',{bubbles:true}));
         item.el.dispatchEvent(new Event('change',{bubbles:true}));
       });
     });
     if(save)footer.insertBefore(reset,save);
     const error=footer.querySelector('#xpb-error');
     if(error){
       const refresh=()=>{
         const strong=summary.querySelector('strong');
         if(strong)strong.textContent=error.textContent.trim()?'Проверьте предупреждения':'Проверьте настройки';
       };
       new MutationObserver(refresh).observe(error,{childList:true,characterData:true,subtree:true});
       refresh();
     }
   }
 }
 const view=document.getElementById('view');
 if(!view)return;
 function scan(){view.querySelectorAll('.xray-builder').forEach(apply)}
 const observer=new MutationObserver(scan);
 observer.observe(view,{childList:true,subtree:true});
 scan();
})();
