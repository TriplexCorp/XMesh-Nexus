(()=>{
'use strict';
if(window.__xmeshUserPolicyCalendarV6||typeof window.userNew!=='function')return;
window.__xmeshUserPolicyCalendarV6=true;

const DAY=86400000;
const iconCalendar='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4.5 8.5h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const iconChevron='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const iconPrev='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const iconNext=iconChevron;

const pad=n=>String(n).padStart(2,'0');
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd=value=>{
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!m)return null;
  const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12,0,0,0);
  return Number.isNaN(d.getTime())?null:d;
};
const serial=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;
const today=()=>{const d=new Date();d.setHours(12,0,0,0);return d};
const targetForDays=days=>{const d=today();d.setDate(d.getDate()+Math.max(0,Number(days)||0));return d};
const daysForDate=value=>{
  const target=parseYmd(value); if(!target)return 0;
  return Math.max(1,Math.round(serial(target)-serial(today())));
};
const dateLabel=d=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(d);
const monthLabel=d=>{
  const text=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(d);
  return text.charAt(0).toUpperCase()+text.slice(1);
};

function durationCopy(root){
  const input=root.querySelector('[name="days"]');
  const value=Math.max(0,Number(input?.value)||0);
  const hold=!!document.querySelector('#dlg.user-create-modal [name="hold"]:checked');
  const title=root.querySelector('[data-user-create-duration-value]');
  const detail=root.querySelector('[data-user-create-duration-detail]');
  if(!title||!detail)return;
  if(value<=0){
    title.textContent='Бессрочно';
    detail.textContent='Без даты окончания';
  }else if(hold){
    title.textContent=`${value} ${value===1?'день':value<5?'дня':'дней'}`;
    detail.textContent='Срок начнётся с первого подключения';
  }else{
    title.textContent=`${value} ${value===1?'день':value<5?'дня':'дней'}`;
    detail.textContent=`До ${dateLabel(targetForDays(value))}`;
  }
}

function calendarMarkup(root,monthDate){
  const input=root.querySelector('[name="days"]');
  const days=Math.max(0,Number(input?.value)||0);
  const selected=days>0?ymd(targetForDays(days)):'';
  const now=today();
  const todayKey=ymd(now);
  const first=new Date(monthDate.getFullYear(),monthDate.getMonth(),1,12,0,0,0);
  const offset=(first.getDay()+6)%7;
  const total=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const blanks=Array.from({length:offset},()=>'<span class="user-create-cal-empty" aria-hidden="true"></span>').join('');
  const daysHtml=Array.from({length:total},(_,i)=>{
    const d=new Date(first.getFullYear(),first.getMonth(),i+1,12,0,0,0);
    const key=ymd(d);
    const past=serial(d)<serial(now);
    const cls=['user-create-cal-day'];
    if(key===todayKey)cls.push('is-today');
    if(key===selected)cls.push('is-selected');
    return `<button type="button" class="${cls.join(' ')}" data-user-create-date="${key}"${past?' disabled':''}>${i+1}</button>`;
  }).join('');
  const presets=[['0','∞'],['7','7 дней'],['30','30 дней'],['90','90 дней'],['180','180 дней']].map(([value,label])=>`<button type="button" data-user-create-days-preset="${value}" class="user-create-duration-preset${Number(value)===days?' is-active':''}">${label}</button>`).join('');
  return `<div class="user-create-duration-presets" aria-label="Быстрый срок">${presets}</div>
    <div class="user-create-cal-head">
      <button type="button" class="user-create-cal-nav" data-user-create-calendar-nav="-1" aria-label="Предыдущий месяц">${iconPrev}</button>
      <strong>${monthLabel(first)}</strong>
      <button type="button" class="user-create-cal-nav" data-user-create-calendar-nav="1" aria-label="Следующий месяц">${iconNext}</button>
    </div>
    <div class="user-create-cal-weekdays">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="user-create-cal-grid">${blanks}${daysHtml}</div>
    <div class="user-create-cal-foot"><span>Выберите дату окончания</span><button type="button" data-user-create-days-preset="0">Сбросить срок</button></div>`;
}

function renderCalendar(root,date){
  const panel=root.querySelector('[data-user-create-duration-calendar]');
  if(!panel)return;
  const month=new Date(date.getFullYear(),date.getMonth(),1,12,0,0,0);
  panel.dataset.month=ymd(month);
  panel.innerHTML=calendarMarkup(root,month);
}

function setDays(root,value,{close=true}={}){
  const input=root.querySelector('[name="days"]'); if(!input)return;
  input.value=String(Math.max(0,Math.round(Number(value)||0)));
  durationCopy(root);
  const panel=root.querySelector('[data-user-create-duration-calendar]');
  if(panel&&!panel.hidden)renderCalendar(root,input.value==='0'?today():targetForDays(Number(input.value)));
  if(close&&panel){panel.hidden=true;root.querySelector('[data-user-create-duration-open]')?.setAttribute('aria-expanded','false');root.classList.remove('is-open')}
}

function enhance(){
  const modal=document.querySelector('#dlg.user-create-modal');
  const old=modal?.querySelector('.user-create-days');
  if(!modal||!old||old.matches('[data-user-create-duration]'))return;
  const existing=old.querySelector('[name="days"]');
  const initial=Math.max(0,Number(existing?.value)||0);
  const root=document.createElement('div');
  root.className='f user-create-field user-create-days user-create-duration';
  root.dataset.userCreateDuration='';
  root.innerHTML=`<span>Срок доступа</span>
    <input type="hidden" name="days" value="${initial}" data-user-create-days>
    <button type="button" class="user-create-duration-trigger" data-user-create-duration-open aria-haspopup="dialog" aria-expanded="false">
      <span class="user-create-duration-icon">${iconCalendar}</span>
      <span class="user-create-duration-copy"><b data-user-create-duration-value>Бессрочно</b><small data-user-create-duration-detail>Без даты окончания</small></span>
      <span class="user-create-duration-chevron">${iconChevron}</span>
    </button>
    <small>Быстрый срок или точная дата в календаре.</small>
    <div class="user-create-duration-calendar" data-user-create-duration-calendar hidden></div>`;
  old.replaceWith(root);
  durationCopy(root);

  const tpl=modal.querySelector('#tplsel');
  if(tpl)tpl.addEventListener('change',()=>queueMicrotask(()=>{
    durationCopy(root);
    const panel=root.querySelector('[data-user-create-duration-calendar]');
    if(panel&&!panel.hidden)renderCalendar(root,Number(root.querySelector('[name="days"]')?.value)>0?targetForDays(Number(root.querySelector('[name="days"]')?.value)):today());
  }));
  modal.querySelector('[name="hold"]')?.addEventListener('change',()=>durationCopy(root));
}

const base=window.userNew;
window.userNew=function userNewPolicyCalendarV6(){
  const result=base.apply(this,arguments);
  enhance();
  return result;
};

document.addEventListener('click',ev=>{
  const modal=document.querySelector('#dlg.user-create-modal');
  if(!modal)return;
  const root=ev.target.closest?.('[data-user-create-duration]');
  const open=ev.target.closest?.('[data-user-create-duration-open]');
  if(open&&root){
    const panel=root.querySelector('[data-user-create-duration-calendar]');
    if(!panel)return;
    const nextHidden=!panel.hidden;
    modal.querySelectorAll('[data-user-create-duration-calendar]').forEach(x=>{x.hidden=true;x.closest('[data-user-create-duration]')?.classList.remove('is-open')});
    if(nextHidden){open.setAttribute('aria-expanded','false');return}
    const value=Number(root.querySelector('[name="days"]')?.value)||0;
    renderCalendar(root,value>0?targetForDays(value):today());
    panel.hidden=false;root.classList.add('is-open');open.setAttribute('aria-expanded','true');
    return;
  }
  const preset=ev.target.closest?.('[data-user-create-days-preset]');
  if(preset&&root){setDays(root,preset.dataset.userCreateDaysPreset);return}
  const day=ev.target.closest?.('[data-user-create-date]');
  if(day&&root&&!day.disabled){setDays(root,daysForDate(day.dataset.userCreateDate));return}
  const nav=ev.target.closest?.('[data-user-create-calendar-nav]');
  if(nav&&root){
    const panel=root.querySelector('[data-user-create-duration-calendar]');
    const current=parseYmd(panel?.dataset.month)||today();
    current.setMonth(current.getMonth()+Number(nav.dataset.userCreateCalendarNav||0));
    renderCalendar(root,current);return;
  }
  if(!root){
    modal.querySelectorAll('[data-user-create-duration-calendar]').forEach(panel=>{panel.hidden=true;panel.closest('[data-user-create-duration]')?.classList.remove('is-open');panel.closest('[data-user-create-duration]')?.querySelector('[data-user-create-duration-open]')?.setAttribute('aria-expanded','false')});
  }
});
})();
