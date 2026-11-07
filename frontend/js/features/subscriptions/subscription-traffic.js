'use strict';
// Shared by the bearer-scoped customer page and Studio's sample preview.
window.XMeshSubscriptionTraffic={mount(metric,{used,limit,servers=[],language='ru'}){
  metric.querySelector('.portal-donut')?.remove();
  const en=language==='en',text=en?{total:'Used',other:'Unattributed usage',empty:'No server measurements yet',all:'All servers',limit:'Limit',unlimited:'Unlimited'}:{total:'Использовано',other:'Без привязки к серверу',empty:'Измерений по серверам пока нет',all:'Все серверы',limit:'Лимит',unlimited:'Без лимита'};
  const fmt=n=>new Intl.NumberFormat(en?'en-GB':'ru-RU',{maximumFractionDigits:2}).format(n)+' '+(en?'GB':'ГБ');
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
  const allowance=el('p','portal-donut-allowance',limit>0?text.limit+': '+fmt(limit):text.unlimited);root.append(allowance);
  metric.querySelectorAll(':scope > b,:scope > .subscription-preview-progress,:scope > .portal-usage-allowance,:scope > .portal-usage-breakdown').forEach(n=>n.hidden=true);
}};
