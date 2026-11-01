(()=>{
  'use strict';

  const ROLE_ATTR='data-ui-surface';
  const registry=[];
  let observer=null;

  const normalizeRole=role=>{
    const allowed=new Set(['panel','dialog','section','metric','item','floating']);
    return allowed.has(role)?role:null;
  };

  const setRole=(node,role)=>{
    if(!(node instanceof Element)||node.hasAttribute(ROLE_ATTR))return false;
    const normalized=normalizeRole(role);
    if(!normalized)return false;
    node.setAttribute(ROLE_ATTR,normalized);
    return true;
  };

  const apply=(root=document,selector=null,role=null)=>{
    if(!root)return 0;
    let count=0;
    if(selector&&role){
      const nodes=[];
      if(root instanceof Element&&root.matches(selector))nodes.push(root);
      if(root.querySelectorAll)nodes.push(...root.querySelectorAll(selector));
      for(const node of nodes)if(setRole(node,role))count++;
      return count;
    }
    for(const entry of registry){
      const nodes=[];
      if(root instanceof Element&&root.matches(entry.selector))nodes.push(root);
      if(root.querySelectorAll)nodes.push(...root.querySelectorAll(entry.selector));
      for(const node of nodes)if(setRole(node,entry.role))count++;
    }
    return count;
  };

  const register=(selector,role)=>{
    const normalized=normalizeRole(role);
    if(!selector||!normalized)return false;
    if(registry.some(entry=>entry.selector===selector&&entry.role===normalized))return true;
    registry.push({selector,role:normalized});
    apply(document,selector,normalized);
    return true;
  };

  const classifySemantic=(root=document)=>{
    let count=0;
    const visit=node=>{
      if(!(node instanceof Element)||node.hasAttribute(ROLE_ATTR))return;
      if(node.matches('dialog .box,dialog form.box'))count+=setRole(node,'dialog')?1:0;
      else if(node.matches('.card'))count+=setRole(node,'panel')?1:0;
      else if(node.matches('section'))count+=setRole(node,'section')?1:0;
      else if(node.matches('.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"]'))count+=setRole(node,'metric')?1:0;
    };
    if(root instanceof Element)visit(root);
    if(root.querySelectorAll)for(const node of root.querySelectorAll('dialog .box,dialog form.box,.card,section,.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"]'))visit(node);
    return count;
  };

  const hydrate=root=>classifySemantic(root)+apply(root);

  const start=()=>{
    hydrate(document);
    if(observer)return;
    observer=new MutationObserver(records=>{
      for(const record of records){
        for(const node of record.addedNodes){
          if(node.nodeType===Node.ELEMENT_NODE)hydrate(node);
        }
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  };

  /* Central legacy adapter table. Feature code must not implement its own
   * Classic/Glass/Raised material rules. New markup should set data-ui-surface. */
  register('.squad-editor-layout>section','section');
  register('.squad-preview-section','section');
  register('.squad-preview-stat','metric');
  register('.squad-inbound-row','item');
  register('.xm-select-popover','floating');
  register('.node-form-section','section');
  register('.subscription-studio-section','section');
  register('.sv-section','section');

  window.XMeshUIBuilder=Object.freeze({
    register,
    apply:hydrate,
    surface:(element,role)=>setRole(element,role),
    roles:Object.freeze(['panel','dialog','section','metric','item','floating'])
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
