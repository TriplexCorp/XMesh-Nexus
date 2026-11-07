'use strict';
// Shared by the bearer-scoped customer page and Studio's sample preview.
window.XMeshSubscriptionTraffic={mount(metric,{used,limit,servers=[],language='ru'}){
  metric._portalDistribution?.remove();
  metric.querySelector('.portal-donut')?.remove();
  const en=language==='en',text=en?{total:'Total',other:'Unattributed usage',empty:'No server measurements yet',all:'All servers',limit:'Limit',remaining:'Remaining',unlimited:'Unlimited'}:{total:'Всего',other:'Без привязки к серверу',empty:'Измерений по серверам пока нет',all:'Все серверы',limit:'Лимит',remaining:'Осталось',unlimited:'Без лимита'};
  const fmt=n=>{const power=n>=1048576?2:n>=1024?1:0;return new Intl.NumberFormat(en?'en-GB':'ru-RU',{maximumFractionDigits:2}).format(n/(1024**power))+' '+(en?['GB','TB','PB']:['ГБ','ТБ','ПБ'])[power]};
  const items=servers.filter(s=>Number.isFinite(s.gib)&&s.gib>0).map(s=>({name:String(s.name),gib:s.gib}));
  const measured=items.reduce((n,s)=>n+s.gib,0);
  if(used-measured>1e-6)items.push({name:text.other,gib:used-measured});
  const total=Math.max(used,measured),ns='http://www.w3.org/2000/svg';
  const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n};
  const svgEl=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n};
  const root=el('div','portal-donut'),chart=el('div','portal-donut-chart'),svg=svgEl('svg',{viewBox:'0 0 200 200','aria-label':en?'Usage by server':'Расход по серверам'});
  const center=el('div','portal-donut-center'),label=el('small','',text.total),amount=el('b','',fmt(total));center.append(label,amount);chart.append(svg,center);
  svg.append(svgEl('circle',{cx:100,cy:100,r:76,fill:'none',stroke:'var(--cabinet-line)','stroke-width':20}));
  const legend=el('div','portal-donut-legend'),buttons=[],arcs=[];let offset=0,selected=-1;
  const select=index=>{label.textContent=index<0?text.total:items[index].name;amount.textContent=fmt(index<0?total:items[index].gib);buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));arcs.forEach((a,i)=>{a.setAttribute('aria-pressed',String(i===selected));a.style.opacity=index<0||i===index?'1':'.3';a.style.strokeWidth=index===i?'25':'20'})};
  const choose=i=>{selected=selected===i?-1:i;select(selected)};
  items.forEach((item,i)=>{
    const color=i===0?'var(--portal-accent)':`hsl(${(i*67+205)%360} 60% 65%)`,share=item.gib/total*100;
    const arc=svgEl('circle',{cx:100,cy:100,r:76,fill:'none',stroke:color,'stroke-width':20,pathLength:100,'stroke-dasharray':`${share} ${100-share}`,'stroke-dashoffset':-offset,transform:'rotate(-90 100 100)',tabindex:0,role:'button','aria-label':item.name+': '+fmt(item.gib)});
    offset+=share;arcs.push(arc);svg.append(arc);
    const button=el('button','portal-donut-server');button.type='button';button.setAttribute('aria-pressed','false');button.style.setProperty('--server-color',color);button.append(el('span','',item.name),el('b','',fmt(item.gib)));buttons.push(button);legend.append(button);
    for(const target of [arc,button]){
      target.addEventListener('pointerenter',()=>select(i));target.addEventListener('pointerleave',()=>select(selected));target.addEventListener('focus',()=>select(i));target.addEventListener('blur',()=>select(selected));target.addEventListener('click',()=>choose(i));
      target.addEventListener('keydown',event=>{if(event.key==='Escape'){selected=-1;select(-1)}if(target===arc&&['Enter',' '].includes(event.key)){event.preventDefault();choose(i)}});
    }
  });
  const reset=el('button','portal-donut-reset',text.all);reset.type='button';reset.addEventListener('click',()=>{selected=-1;select(-1)});
  if(items.length)legend.append(reset);else legend.append(el('p','',text.empty));
  root.append(chart,legend);metric.append(root);
  root.dataset.unlimited=String(limit===0);
  const summary=el('div','experience-unlimited-summary');summary.append(el('b','',fmt(total)),el('small','',limit===0?text.unlimited:text.total));root.prepend(summary);
  if(items.length){const details=el('details','experience-server-details'),heading=el('summary','',en?'By server':'По серверам');const content=el('div','experience-distribution-content');content.append(chart,legend);details.append(heading,content);metric._portalDistribution=details;root.append(details)}
  else{chart.hidden=true;legend.hidden=true;summary.append(el('p','',text.empty))}
  if(limit>0){const meter=el('div','experience-quota-meter');meter.setAttribute('role','progressbar');meter.setAttribute('aria-label',en?'Data allowance used':'Использовано лимита');meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax',String(limit));meter.setAttribute('aria-valuenow',String(Math.min(total,limit)));meter.setAttribute('aria-valuetext',fmt(total)+' / '+fmt(limit));const fill=el('i');fill.style.width=Math.min(100,total/limit*100)+'%';meter.append(fill);root.append(meter)}

  const allowance=el('p','portal-donut-allowance',limit>0?text.limit+': '+fmt(limit)+' · '+text.remaining+': '+fmt(Math.max(0,limit-total)):text.unlimited);root.append(allowance);if(limit===0)allowance.hidden=true;
  if(servers.length&&servers.every(s=>Number.isFinite(s.upload)&&Number.isFinite(s.download))){
    const directions=el('div','experience-directions');
    for(const [key,title]of [['download',en?'Downloaded':'Скачано'],['upload',en?'Uploaded':'Отправлено']]){const field=el('div');field.append(el('small','',title),el('b','',fmt(servers.reduce((n,s)=>n+s[key],0))));directions.append(field)}
    if(used-measured>1e-6)directions.append(el('small','',en?'Measured server traffic only':'Только учтённый трафик серверов'));
    root.append(directions);
  }

  metric.querySelectorAll(':scope > b,:scope > .subscription-preview-progress,:scope > .portal-usage-allowance,:scope > .portal-usage-breakdown').forEach(n=>n.hidden=true);
}};
