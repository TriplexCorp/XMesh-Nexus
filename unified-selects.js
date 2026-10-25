/* XMesh Nexus unified select experience.
 * Progressively enhances native single-choice <select> without replacing its form value.
 * Popover top layer works above modal <dialog>; native remains a fallback when unsupported.
 */
(()=>{
 'use strict';
 if(typeof document==='undefined')return;
 const supportsPopover=typeof HTMLElement.prototype.showPopover==='function';
 const instances=new Map();
 const SKIP='select[multiple],select[size]:not([size="1"]),select.country-select,select[data-xm-native],.xm-period-select select,.country-picker select,select[hidden]';
 const eligible=el=>el instanceof HTMLSelectElement&&!el.matches(SKIP)&&!el.closest('[inert]')&&el.options.length>0;
 let active=null;
 const textFor=option=>option?.textContent?.trim()||'—';
 function dismiss(instance,restoreFocus=false){
  if(!instance||instance.disposed)return;
  if(supportsPopover){if(instance.popup.matches(':popover-open'))instance.popup.hidePopover();}
  else instance.popup.hidden=true;
  instance.trigger.setAttribute('aria-expanded','false');
  instance.wrapper.classList.remove('is-open');
  if(active===instance)active=null;
  if(restoreFocus&&instance.trigger.isConnected)instance.trigger.focus({preventScroll:true});
 }
 function place(instance){
  if(!instance||!instance.trigger.isConnected)return;
  const b=instance.trigger.getBoundingClientRect();
  const popup=instance.popup;
  const height=Math.min(popup.scrollHeight||260,Math.max(100,innerHeight*.45));
  const below=innerHeight-b.bottom>=height+8||innerHeight-b.bottom>=b.top;
  popup.style.width=Math.max(120,Math.min(b.width,innerWidth-16))+'px';
  popup.style.maxHeight=Math.max(95,Math.min(340,innerHeight-24))+'px';
  popup.style.left=Math.max(8,Math.min(b.left,innerWidth-b.width-8))+'px';
  popup.style.top=Math.round(below?Math.min(b.bottom+5,innerHeight-90):Math.max(8,b.top-height-5))+'px';
 }
 function buildOptions(instance){
  const {select,popup}=instance;
  const frag=document.createDocumentFragment();
  [...select.options].forEach((option,i)=>{
   const item=document.createElement('button');
   item.type='button';item.className='xm-select-option';
   item.setAttribute('role','option');item.dataset.optionIndex=String(i);
   item.setAttribute('aria-selected',String(option.selected));
   item.disabled=option.disabled||!!option.closest('optgroup[disabled]');
   item.textContent=textFor(option);
   if(option.parentElement instanceof HTMLOptGroupElement) {
    item.classList.add('in-group');
    item.setAttribute('aria-label',option.parentElement.label+': '+textFor(option));
   }
   frag.append(item);
  });
  popup.replaceChildren(frag);
 }
 function sync(instance){
  if(instance.disposed||!instance.select.isConnected)return;
  const {select,trigger,wrapper}=instance;
  // Keep real form control as the only source of truth.
  trigger.querySelector('.xm-select-caption').textContent=textFor(select.selectedOptions[0]);
  trigger.disabled=select.disabled;
  wrapper.classList.toggle('is-disabled',select.disabled);
  trigger.setAttribute('aria-required',String(select.required));
  trigger.setAttribute('aria-invalid',select.getAttribute('aria-invalid')||'false');
  const title=select.getAttribute('aria-label')||select.labels?.[0]?.textContent?.trim()||select.getAttribute('title')||'Выбор';
  trigger.setAttribute('aria-label',title+': '+textFor(select.selectedOptions[0]));
  if(active===instance){buildOptions(instance);place(instance)}
 }
 function release(instance){
  if(instance.disposed)return;
  dismiss(instance);
  instance.disposed=true;
  instance.observer.disconnect();
  instance.popup.remove();
  // Component cleanup for detached view/dialog; never keep stale portal references.
  instances.delete(instance.select);
 }
 function open(instance){
  if(instance.select.disabled||instance.disposed)return;
  if(active&&active!==instance)dismiss(active);
  buildOptions(instance);
  if(supportsPopover)instance.popup.showPopover();else instance.popup.hidden=false;
  active=instance;
  instance.wrapper.classList.add('is-open');
  instance.trigger.setAttribute('aria-expanded','true');
  place(instance);
  instance.popup.querySelector('[aria-selected="true"]:not(:disabled)')?.scrollIntoView({block:'nearest'});
 }
 function enhance(select){
  if(instances.has(select)||!eligible(select)||select.closest('.xm-select-shell'))return;
  const shell=document.createElement('span');shell.className='xm-select-shell';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='xm-select-trigger';
  trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const caption=document.createElement('span');caption.className='xm-select-caption';
  const chevron=document.createElement('span');chevron.className='xm-select-chevron';chevron.setAttribute('aria-hidden','true');chevron.textContent='⌄';
  trigger.append(caption,chevron);
  const popup=document.createElement('div');popup.className='xm-select-popover';
  if(supportsPopover)popup.setAttribute('popover','manual');else popup.hidden=true;
  popup.setAttribute('role','listbox');
  // popover lives in the top layer, even when opened from a <dialog>.
  document.body.append(popup);
  select.before(shell);shell.append(select,trigger);
  select.classList.add('xm-select-source');
  const instance={select,wrapper:shell,trigger,popup,observer:null,disposed:false};
  instances.set(select,instance);
  instance.observer=new MutationObserver(()=>sync(instance));
  instance.observer.observe(select,{attributes:true,childList:true,subtree:true,characterData:true,attributeFilter:['disabled','selected','label','aria-label','title','required','aria-invalid']});
  select.addEventListener('change',()=>sync(instance));
  select.addEventListener('input',()=>sync(instance));
  trigger.addEventListener('click',()=>active===instance?dismiss(instance):open(instance));
  trigger.addEventListener('keydown',e=>{
   if(e.key==='Escape'){dismiss(instance);return}
   if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){
    e.preventDefault();open(instance);
    const options=[...popup.querySelectorAll('.xm-select-option:not(:disabled)')];
    const selected=options.find(el=>Number(el.dataset.optionIndex)===select.selectedIndex);
    (selected||options[0])?.focus({preventScroll:true});
   }
  });
  popup.addEventListener('click',e=>{
   const option=e.target.closest('.xm-select-option');
   if(!option||option.disabled)return;
   const i=Number(option.dataset.optionIndex);
   if(select.selectedIndex!==i){
    select.selectedIndex=i;
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
   }
   dismiss(instance,true);
  });
  popup.addEventListener('keydown',e=>{
   const opts=[...popup.querySelectorAll('.xm-select-option:not(:disabled)')];
   const at=opts.indexOf(document.activeElement);
   if(e.key==='Escape'){e.preventDefault();dismiss(instance,true)}
   else if(e.key==='Tab'){dismiss(instance)}
   else if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){
    e.preventDefault();
    if(!opts.length)return;
    const next=e.key==='Home'?0:e.key==='End'?opts.length-1:at<0?0:(at+(e.key==='ArrowDown'?1:-1)+opts.length)%opts.length;
    opts[next]?.focus();
   }else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    const q=e.key.toLocaleLowerCase();
    const next=opts.find(el=>el.textContent.trim().toLocaleLowerCase().startsWith(q));
    next?.focus();
   }
  });
  if(supportsPopover)popup.addEventListener('toggle',e=>{if(e.newState==='closed')dismiss(instance)});
  sync(instance);
 }
 function scan(root){
  if(root instanceof HTMLSelectElement)enhance(root);
  if(root?.querySelectorAll)root.querySelectorAll('select').forEach(enhance);
 }
 const observer=new MutationObserver(records=>{
  for(const r of records){
   r.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node)});
  }
  // When a rerender replaces a view/dialog, dispose orphaned portals.
  for(const instance of instances.values())if(!instance.select.isConnected)release(instance);
 });
 function refresh(root=document){
  scan(root);
  if(root instanceof Element && root.matches('dialog'))root.querySelectorAll('select').forEach(enhance);
  for(const instance of instances.values())if(instance.select.isConnected)sync(instance);
 }
 // Dynamic dialogs can be populated while not open. Allow explicit post-render
 // enhancement without waiting for MutationObserver scheduling.
 window.XMeshSelects={refresh};
 function boot(){
  refresh(document);
  observer.observe(document.body,{childList:true,subtree:true});
  document.addEventListener('pointerdown',e=>{
   if(active&&!active.wrapper.contains(e.target)&&!active.popup.contains(e.target))dismiss(active);
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)dismiss(active,true)},true);
  document.addEventListener('scroll',()=>{if(active)place(active)},{capture:true,passive:true});
  window.addEventListener('resize',()=>{if(active)place(active)});
  document.addEventListener('close',e=>{if(e.target instanceof HTMLDialogElement&&active)dismiss(active)},true);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
