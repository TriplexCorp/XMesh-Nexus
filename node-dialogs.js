'use strict';

// The shared panel confirmation is deliberately non-destructive and resolves
// through its existing Cancel button. Add a visual close control without
// bypassing that contract: clicking X delegates to the same cancel action.
(()=>{
  const closeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function enhance(dialog){
    if(!(dialog instanceof HTMLDialogElement))return;
    if(!dialog.matches('dialog.xm-action-confirm'))return;
    if(!dialog.querySelector('.xm-action-confirm-icon'))return;
    if(dialog.querySelector('[data-node-confirm-close]'))return;
    const box=dialog.querySelector('.xm-action-confirm-box');
    if(!box)return;

    const close=document.createElement('button');
    close.type='button';
    close.className='xm-action-confirm-close';
    close.dataset.nodeConfirmClose='';
    close.setAttribute('aria-label','Закрыть');
    close.innerHTML=closeIcon;
    close.addEventListener('click',()=>{
      const cancel=dialog.querySelector('.xm-action-confirm-actions .gh');
      if(cancel instanceof HTMLButtonElement)cancel.click();
      else dialog.close();
    });
    box.append(close);
  }

  function scan(root=document){
    if(root instanceof HTMLDialogElement)enhance(root);
    root.querySelectorAll?.('dialog.xm-action-confirm').forEach(enhance);
  }

  scan();
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{
    if(node.nodeType===1)scan(node);
  }))).observe(document.documentElement,{childList:true,subtree:true});
})();
