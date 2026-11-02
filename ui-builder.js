(()=>{
  'use strict';

  const ROLE_ATTR='data-ui-surface';
  const LAYOUT_ATTR='data-ui-layout';
  const FLOW_ATTR='data-ui-flow';
  const registry=[];
  let observer=null;
  let spatialFrame=0;

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
      /* A semantic <section> inside a modal is structural by default. The dialog
       * shell already owns material/depth; modal groups opt in explicitly or via
       * the central legacy registry when they genuinely need a surface. */
      else if(node.matches('section')&&!node.closest('dialog'))count+=setRole(node,'section')?1:0;
      else if(node.matches('.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"]'))count+=setRole(node,'metric')?1:0;
    };
    if(root instanceof Element)visit(root);
    if(root.querySelectorAll)for(const node of root.querySelectorAll('dialog .box,dialog form.box,.card,section,.squad-preview-stat,.stat,[class*="-kpi"],[class~="kpi"]'))visit(node);
    return count;
  };

  const hasEmptyMarker=node=>{
    if(!(node instanceof Element))return false;
    if(node.matches('.empty,[data-empty-state]'))return true;
    const candidates=node.querySelectorAll('.empty,[data-empty-state],[class*="empty"]');
    for(const item of candidates){
      const cls=typeof item.className==='string'?item.className:'';
      if(item.matches('.empty,[data-empty-state]')||/(^|[\s_-])empty([\s_-]|$)/i.test(cls))return true;
    }
    return false;
  };

  const isEditor=node=>!!(node.closest?.('.sv-studio,[data-ui-editor],[data-ui-layout="editor"]')||node.matches?.('.sv-studio,.sv-workspace,[data-ui-editor]'));

  const classifyToolbar=node=>{
    if(!(node instanceof Element)||node.closest('dialog')||isEditor(node))return;
    const looksLikeToolbar=node.matches('.bar2,.toolbar,[class$="-toolbar"],[class*="-toolbar "]');
    if(!looksLikeToolbar||!node.querySelector('button,input,select,.xm-select-trigger'))return;
    const filterSignals=node.querySelector('input[type="search"],select,[data-filter],[data-search]');
    node.setAttribute('data-ui-toolbar',filterSignals?'filters':'actions');
  };

  const classifyCard=card=>{
    if(!(card instanceof Element)||card.closest('dialog'))return;
    if(isEditor(card)){
      card.setAttribute(LAYOUT_ATTR,'editor');
      return;
    }
    const table=card.querySelector('table');
    if(table){
      card.setAttribute(LAYOUT_ATTR,'table');
      const rows=table.querySelectorAll('tbody tr').length;
      card.setAttribute('data-ui-table-rows',String(rows));
      card.setAttribute('data-ui-table-density',rows===0?'empty':rows<=3?'low':'normal');
      return;
    }
    if(hasEmptyMarker(card)){
      card.setAttribute(LAYOUT_ATTR,'empty');
      return;
    }
    if(!card.hasAttribute(LAYOUT_ATTR))card.setAttribute(LAYOUT_ATTR,'panel');
  };

  const classifyMetrics=view=>{
    for(const box of view.querySelectorAll('div,section')){
      if(box.closest('dialog')||isEditor(box))continue;
      const children=[...box.children].filter(node=>node instanceof Element);
      if(children.length<2||children.length>12)continue;
      const metricCount=children.filter(node=>node.matches('.stat,[class*="-kpi"],[class~="kpi"],[data-ui-surface="metric"]')).length;
      if(metricCount===children.length)box.setAttribute('data-ui-metrics','');
    }
  };

  const classifyCollections=view=>{
    for(const box of view.querySelectorAll('div,section')){
      if(box.closest('dialog')||isEditor(box)||box.matches('.view'))continue;
      const children=[...box.children].filter(node=>node instanceof Element);
      if(!children.length||children.length>24)continue;
      const cardChildren=children.filter(node=>node.matches('.card,[data-ui-surface="panel"]'));
      if(cardChildren.length!==children.length)continue;
      const display=getComputedStyle(box).display;
      if(display!=='grid'&&display!=='flex')continue;
      box.setAttribute('data-ui-collection','');
      box.setAttribute('data-ui-count',String(cardChildren.length));
      if(display==='grid'&&cardChildren.length<=3)box.setAttribute('data-ui-low-count','expand');
    }
  };

  const measureSparse=view=>{
    const panels=view.querySelectorAll(':scope > .card,:scope > section.card,:scope > [data-ui-surface="panel"],:scope > section > .card');
    let sparse=0,total=0;
    for(const panel of panels){
      if(!(panel instanceof Element)||panel.closest('dialog')||isEditor(panel))continue;
      total++;
      const layout=panel.getAttribute(LAYOUT_ATTR);
      if(layout==='empty'){
        sparse++;
        continue;
      }
      if(layout==='table'){
        if(Number(panel.getAttribute('data-ui-table-rows')||0)<=3)sparse++;
        continue;
      }
      const rect=panel.getBoundingClientRect();
      if(rect.height<250||rect.width<320)continue;
      const content=[...panel.children].filter(child=>{
        const style=getComputedStyle(child);
        return style.display!=='none'&&style.position!=='absolute'&&style.position!=='fixed';
      });
      if(!content.length)continue;
      const boxes=content.map(child=>child.getBoundingClientRect()).filter(box=>box.height>0);
      if(!boxes.length)continue;
      const top=Math.min(...boxes.map(box=>box.top));
      const bottom=Math.max(...boxes.map(box=>box.bottom));
      const used=Math.max(0,bottom-top);
      const dead=Math.max(0,rect.height-used);
      if(dead>110&&dead/rect.height>.28){
        panel.setAttribute(LAYOUT_ATTR,'sparse');
        sparse++;
      }
    }
    view.setAttribute('data-ui-page-density',total&&sparse>=Math.ceil(total/2)?'sparse':'normal');
  };

  const composeNodes=view=>{
    for(const page of view.querySelectorAll('.nodes-page')){
      const toolbar=page.querySelector(':scope > .nodes-toolbar');
      const explorer=page.querySelector(':scope > .node-explorer');
      if(toolbar&&explorer&&!explorer.dataset.uiSpatialToolbar){
        const gridControls=toolbar.querySelector('.node-grid-controls');
        const createAction=toolbar.querySelector('.node-create-action');
        const meta=page.querySelector(':scope > .node-explorer-meta');
        const count=meta?.querySelector('[data-node-search-count]');
        const pages=meta?.querySelector('.node-explorer-pages');
        const search=explorer.querySelector('.node-explorer-search');
        if(count){
          count.classList.add('node-result-chip');
          if(search?.nextSibling)explorer.insertBefore(count,search.nextSibling);
          else explorer.append(count);
        }
        if(pages)explorer.append(pages);
        if(gridControls)explorer.append(gridControls);
        if(createAction)explorer.append(createAction);
        if(meta&&!meta.children.length)meta.remove();
        explorer.dataset.uiSpatialToolbar='true';
      }

      const grid=page.querySelector(':scope > .nodes');
      if(!grid||grid.dataset.nodeCount!=='1')continue;
      const card=grid.querySelector(':scope > .nc');
      if(!card||card.dataset.uiSpatialCard)return;
      const kvg=card.querySelector(':scope > .kvg');
      const gauges=card.querySelector(':scope > .node-gauges');
      const speed=card.querySelector(':scope > .node-speed');
      const actions=card.querySelector(':scope > .acts');
      if(!kvg||!gauges||!actions)continue;

      const summary=document.createElement('div');
      summary.className='node-summary-pane';
      const metrics=document.createElement('div');
      metrics.className='node-metrics-pane';
      card.insertBefore(summary,gauges);
      card.insertBefore(metrics,actions);
      summary.append(kvg);
      for(const child of [...card.children]){
        if(child.matches?.('.node-tls-health,.node-ip-rotation'))summary.append(child);
      }
      metrics.append(gauges);
      if(speed)metrics.append(speed);
      card.dataset.uiSpatialCard='true';
    }
  };

  const classifyWorkspace=view=>{
    if(!(view instanceof Element))return;
    view.setAttribute(FLOW_ATTR,'workspace');
    for(const editor of view.querySelectorAll('.sv-studio,.sv-workspace,[data-ui-editor]'))editor.setAttribute(LAYOUT_ATTR,'editor');
    for(const toolbar of view.querySelectorAll('.bar2,.toolbar,[class$="-toolbar"],[class*="-toolbar "]'))classifyToolbar(toolbar);
    for(const card of view.querySelectorAll('.card,[data-ui-surface="panel"]'))classifyCard(card);
    classifyMetrics(view);
    classifyCollections(view);
    composeNodes(view);
    measureSparse(view);
  };

  const classifySpatial=(root=document)=>{
    const views=[];
    if(root instanceof Element&&root.matches('.view'))views.push(root);
    if(root instanceof Element){
      const own=root.closest?.('.view');
      if(own)views.push(own);
    }
    if(root.querySelectorAll)views.push(...root.querySelectorAll('.view'));
    for(const view of new Set(views))classifyWorkspace(view);
  };

  const scheduleSpatial=root=>{
    if(spatialFrame)cancelAnimationFrame(spatialFrame);
    spatialFrame=requestAnimationFrame(()=>{
      spatialFrame=0;
      classifySpatial(root?.isConnected?root:document);
    });
  };

  const hydrate=root=>{
    const count=classifySemantic(root)+apply(root);
    scheduleSpatial(root);
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
    window.addEventListener('resize',()=>scheduleSpatial(document),{passive:true});
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
    compose:classifySpatial,
    surface:(element,role)=>setRole(element,role),
    roles:Object.freeze(['panel','dialog','section','metric','item','floating']),
    layouts:Object.freeze(['panel','table','empty','sparse','editor','canvas'])
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
