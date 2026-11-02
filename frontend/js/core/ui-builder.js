(()=>{
  'use strict';

  const ROLE_ATTR='data-ui-surface';
  const LAYOUT_ATTR='data-ui-layout';
  const FLOW_ATTR='data-ui-flow';
  const FRAME_ATTR='data-ui-frame';
  const registry=[];
  let observer=null;
  let frame=0;

  const roles=new Set(['panel','dialog','section','metric','item','floating']);
  const layouts=new Set(['panel','table','empty','editor','canvas']);
  const frames=new Set(['management','data','canvas']);
  const collectionSelector='.two,.three,.four,.grid,.cards,[data-ui-collection]';

  const setRole=(node,role)=>{
    if(!(node instanceof Element)||node.hasAttribute(ROLE_ATTR)||!roles.has(role))return false;
    node.setAttribute(ROLE_ATTR,role);
    return true;
  };

  const register=(selector,role)=>{
    if(typeof selector!=='string'||!selector.trim()||!roles.has(role))return false;
    if(!registry.some(entry=>entry.selector===selector&&entry.role===role))registry.push({selector,role});
    return true;
  };

  const applyRegistry=(root=document,selector=null,role=null)=>{
    if(!root)return 0;
    let count=0;
    const applyOne=(sel,nextRole)=>{
      const nodes=[];
      if(root instanceof Element&&root.matches(sel))nodes.push(root);
      if(root.querySelectorAll)nodes.push(...root.querySelectorAll(sel));
      for(const node of nodes)if(setRole(node,nextRole))count++;
    };
    if(selector&&role){
      if(roles.has(role))applyOne(selector,role);
      return count;
    }
    for(const entry of registry)applyOne(entry.selector,entry.role);
    return count;
  };

  const classifySemantic=(root=document)=>{
    let count=0;
    const visit=node=>{
      if(!(node instanceof Element)||node.hasAttribute(ROLE_ATTR))return;
      if(node.matches('dialog .box,dialog form.box'))count+=setRole(node,'dialog')?1:0;
      else if(node.matches('.card'))count+=setRole(node,'panel')?1:0;
      /* Direct children of .view are page-composition roots, not material
       * surfaces. Treating a root <section> as a section surface wraps the
       * whole workspace in one giant card and defeats page-owned layout. */
      else if(node.matches('section')&&!node.closest('dialog')&&!node.parentElement?.matches('.view'))count+=setRole(node,'section')?1:0;
      else if(node.matches('.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"],.ngauge'))count+=setRole(node,'metric')?1:0;
      else if(node.matches('.palette-preset'))count+=setRole(node,'item')?1:0;
    };
    if(root instanceof Element)visit(root);
    if(root.querySelectorAll){
      for(const node of root.querySelectorAll('dialog .box,dialog form.box,.card,section,.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"],.ngauge,.palette-preset'))visit(node);
    }
    return count;
  };

  const isEditor=node=>!!(node?.matches?.('.sv-studio,.sv-workspace,[data-ui-editor]')||node?.closest?.('.sv-studio,.sv-workspace,[data-ui-editor]'));

  const hasEmptyMarker=node=>{
    if(!(node instanceof Element))return false;
    if(node.matches('.empty,[data-empty-state],[class$="-empty"]'))return true;
    return !!node.querySelector('.empty,[data-empty-state],[class$="-empty"],[class*="-empty "]');
  };

  const isCanvas=node=>!!node.querySelector('canvas,[data-ui-canvas],[data-chart]');

  const classifyToolbar=node=>{
    if(!(node instanceof Element)||node.closest('dialog')||isEditor(node))return;
    if(!node.querySelector('button,input,select,.xm-select-trigger,.xm-select-button'))return;
    const hasFilters=!!node.querySelector('input[type="search"],select,[data-filter],[data-search]');
    node.setAttribute('data-ui-toolbar',hasFilters?'filters':'actions');
  };

  const classifyCard=card=>{
    if(!(card instanceof Element)||card.closest('dialog'))return;
    let layout='panel';
    if(isEditor(card))layout='editor';
    else if(isCanvas(card))layout='canvas';
    else if(card.querySelector('table'))layout='table';
    else if(hasEmptyMarker(card))layout='empty';
    card.setAttribute(LAYOUT_ATTR,layout);

    const first=card.firstElementChild;
    const hasHeading=!!(first&&(first.matches('.hd,.bar2,[class$="-heading"],[class*="-heading "]')||first.querySelector('h2,h3')));
    if(hasHeading)card.setAttribute('data-ui-card-head','true');
    else card.removeAttribute('data-ui-card-head');

    if(layout==='table'){
      const rows=card.querySelectorAll('tbody tr').length;
      card.setAttribute('data-ui-table-rows',String(rows));
      card.setAttribute('data-ui-table-density',rows===0?'empty':rows<=3?'low':'normal');
    }else{
      card.removeAttribute('data-ui-table-rows');
      card.removeAttribute('data-ui-table-density');
    }
  };

  const classifyMetrics=view=>{
    for(const box of view.querySelectorAll('div,section')){
      if(box.closest('dialog')||isEditor(box))continue;
      const children=[...box.children].filter(node=>node instanceof Element);
      if(children.length<2||children.length>12)continue;
      const metrics=children.filter(node=>node.matches('.stat,.ngauge,[class*="-kpi"],[class~="kpi"],[data-ui-surface="metric"]'));
      if(metrics.length===children.length)box.setAttribute('data-ui-metrics','');
      else box.removeAttribute('data-ui-metrics');
    }
  };

  /* Collection semantics are opt-in by structural class/attribute. Earlier
   * versions scanned every div/section and accidentally classified Settings
   * columns (three cards) as low-count card collections, producing six skinny
   * columns. A semantic builder must never infer page geometry from coincidence. */
  const classifyCollections=view=>{
    for(const box of view.querySelectorAll(collectionSelector)){
      if(box.closest('dialog')||isEditor(box)||box===view)continue;
      const children=[...box.children].filter(node=>node instanceof Element);
      const cards=children.filter(node=>node.matches('.card,[data-ui-surface="panel"]'));
      if(!children.length||children.length>24||cards.length!==children.length){
        box.removeAttribute('data-ui-collection');
        box.removeAttribute('data-ui-count');
        box.removeAttribute('data-ui-low-count');
        continue;
      }
      const display=getComputedStyle(box).display;
      if(display!=='grid'&&display!=='flex')continue;
      box.setAttribute('data-ui-collection','');
      box.setAttribute('data-ui-count',String(cards.length));
      if(cards.length<=3)box.setAttribute('data-ui-low-count','expand');
      else box.removeAttribute('data-ui-low-count');
    }
  };

  const classifyFrame=view=>{
    if(!(view instanceof Element))return;
    let value='management';
    if(view.querySelector('[data-ui-layout="editor"],[data-ui-layout="canvas"],.sv-studio,.sv-workspace,[data-ui-editor],[data-ui-canvas],canvas,[data-chart]'))value='canvas';
    else if(view.querySelector('[data-ui-layout="table"],table'))value='data';
    view.setAttribute(FRAME_ATTR,frames.has(value)?value:'management');
  };

  const classifyWorkspace=view=>{
    if(!(view instanceof Element))return;
    view.setAttribute(FLOW_ATTR,'workspace');
    for(const editor of view.querySelectorAll('.sv-studio,.sv-workspace,[data-ui-editor]'))editor.setAttribute(LAYOUT_ATTR,'editor');
    for(const toolbar of view.querySelectorAll('.bar2,.toolbar,[class$="-toolbar"],[class*="-toolbar "]'))classifyToolbar(toolbar);
    for(const card of view.querySelectorAll('.card,[data-ui-surface="panel"]'))classifyCard(card);
    classifyMetrics(view);
    classifyCollections(view);
    classifyFrame(view);
  };

  const collectViews=root=>{
    const views=[];
    if(root instanceof Element&&root.matches('.view'))views.push(root);
    if(root instanceof Element){
      const owner=root.closest?.('.view');
      if(owner)views.push(owner);
    }
    if(root?.querySelectorAll)views.push(...root.querySelectorAll('.view'));
    return new Set(views);
  };

  const compose=root=>{
    for(const view of collectViews(root||document))classifyWorkspace(view);
  };

  const schedule=root=>{
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      frame=0;
      compose(root?.isConnected?root:document);
    });
  };

  const hydrate=root=>{
    const count=classifySemantic(root)+applyRegistry(root);
    schedule(root);
    return count;
  };

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
    window.addEventListener('resize',()=>schedule(document),{passive:true});
  };

  /* Legacy semantic adapter registry. It may map old markup to shared roles,
   * but it must never move nodes, measure geometry or implement page styling. */
  register('.squad-editor-layout>section','section');
  register('.squad-preview-section','section');
  register('.squad-preview-stat','metric');
  register('.squad-inbound-row','item');
  register('.xm-select-popover','floating');
  register('.node-form-section','section');
  register('.node-explorer','panel');
  register('.ngauge','metric');
  register('.palette-preset','item');
  register('.subscription-studio-section','section');
  register('.sv-section','section');

  window.XMeshUIBuilder=Object.freeze({
    register,
    apply:hydrate,
    compose,
    surface:(element,role)=>setRole(element,role),
    roles:Object.freeze([...roles]),
    layouts:Object.freeze([...layouts]),
    frames:Object.freeze([...frames])
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
