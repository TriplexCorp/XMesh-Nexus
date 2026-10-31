'use strict';

// Per-user uTLS fingerprint override for the existing user card.
// Empty storage value is inheritance mode: user -> host -> chrome.
(()=>{
  const fallback=['chrome','firefox','safari','ios','android','edge','360','qq','random','randomized','randomizednoalpn','unsafe'];
  const values=()=>Array.from(new Set(typeof XRAY_FP!=='undefined'?XRAY_FP:fallback));
  const findUser=id=>typeof DB!=='undefined'&&Array.isArray(DB.users)
    ?DB.users.find(user=>String(user.id)===String(id))
    :null;

  function inject(form){
    if(!form||form.dataset.userFingerprintInjected==='1')return;
    const fields=form.querySelector('.user-edit-fields');
    const user=findUser(form.dataset.id);
    if(!fields||!user)return;

    const label=document.createElement('label');
    label.className='f user-fingerprint-field';
    const title=document.createElement('span');
    title.textContent='uTLS fingerprint';
    const select=document.createElement('select');
    select.dataset.userFingerprint='';
    select.setAttribute('aria-label','Индивидуальный uTLS fingerprint');

    const inherited=document.createElement('option');
    inherited.value='';
    inherited.textContent='По умолчанию';
    select.append(inherited);
    for(const value of values()){
      const option=document.createElement('option');
      option.value=value;
      option.textContent=value;
      select.append(option);
    }
    select.value=typeof user.fingerprint==='string'?user.fingerprint:'';

    const help=document.createElement('small');
    help.textContent='«По умолчанию» наследует fingerprint из хоста. Если у хоста fingerprint не задан, используется chrome.';
    label.append(title,select,help);

    const strategy=form.querySelector('[name="strategy"]')?.closest('.f');
    if(strategy)strategy.insertAdjacentElement('afterend',label);
    else fields.append(label);
    form.dataset.userFingerprintInjected='1';
  }

  function scan(root=document){
    if(root.matches?.('form[data-k="uedit"]'))inject(root);
    root.querySelectorAll?.('form[data-k="uedit"]').forEach(inject);
  }

  scan();
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType===1)scan(node);
  }))).observe(document.documentElement,{childList:true,subtree:true});

  // Keep the main editor contract unchanged; enrich only the existing user update payload.
  if(typeof api!=='undefined'&&api.update&&!api.update.__userFingerprintOverride){
    const original=api.update.bind(api);
    const wrapped=async (collection,id,patch,...rest)=>{
      if(collection==='users'&&patch&&typeof patch==='object'&&!Array.isArray(patch)){
        const form=[...document.querySelectorAll('form[data-k="uedit"]')]
          .find(candidate=>String(candidate.dataset.id)===String(id));
        const select=form?.querySelector('[data-user-fingerprint]');
        if(select)patch={...patch,fingerprint:select.value};
      }
      return original(collection,id,patch,...rest);
    };
    wrapped.__userFingerprintOverride=true;
    api.update=wrapped;
  }
})();
