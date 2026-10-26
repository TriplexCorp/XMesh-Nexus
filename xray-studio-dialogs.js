/* Accessible, theme-aware dialogs shared by XRAY STUDIO and JSON tools. */
window.XMeshStudioDialogs=(()=>{
'use strict';
let queue=Promise.resolve();
function request(spec={}){
 const run=()=>new Promise(resolve=>{
  const active=document.activeElement;
  const dlg=document.createElement('dialog');
  dlg.className='xm-studio-modal'+(spec.fields?.some(field=>field.type==='cards')?' xm-studio-modal--cards':'');
  dlg.setAttribute('aria-labelledby','xm-studio-modal-title');
  dlg.setAttribute('aria-describedby','xm-studio-modal-description');
  const shell=document.createElement('form');
  shell.method='dialog';
  shell.noValidate=true;
  shell.className='xm-studio-modal-shell';
  const make=(tag,cls,txt)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt!=null)el.textContent=txt;return el};
  const head=make('div','xm-studio-modal-head');
  const mark=make('span','xm-studio-modal-mark');
  mark.setAttribute('aria-hidden','true');
  mark.innerHTML=spec.danger?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/></svg>';
  const text=make('div','xm-studio-modal-copy');
  const overline=make('span','xm-studio-modal-eyebrow',spec.eyebrow||'XRAY STUDIO / ДЕЙСТВИЕ');
  const title=make('h2','',spec.title||'Подтверждение');title.id='xm-studio-modal-title';
  const desc=make('p','',spec.description||'');desc.id='xm-studio-modal-description';
  text.append(overline,title,desc);
  head.append(mark,text);
  const close=make('button','xm-studio-modal-close','×');close.type='button';close.setAttribute('aria-label','Закрыть окно');
  head.append(close);shell.append(head);
  const fields=Array.isArray(spec.fields)?spec.fields:[];
  const grid=make('div','xm-studio-modal-fields');
  const controls=new Map();
  fields.forEach(field=>{
   const wrap=make('label','xm-studio-modal-field'+(field.wide?' is-wide':''));
   const label=make('span','xm-studio-modal-label',field.label||field.name);
   const cards=field.type==='cards';
    const control=cards?document.createElement('input'):field.type==='textarea'?document.createElement('textarea'):field.type==='select'?document.createElement('select'):document.createElement('input');
    if(cards){control.type='hidden';}
   control.name=field.name;
   if(!cards&&field.type!=='select'&&field.type!=='textarea')control.type=field.type||'text';
   control.autocomplete='off';
   if(field.placeholder)control.placeholder=field.placeholder;
   if(field.min!=null)control.min=String(field.min);
   if(field.max!=null)control.max=String(field.max);
   if(field.maxLength!=null)control.maxLength=field.maxLength;
   if(field.type==='textarea'){control.rows=field.rows||5;control.spellcheck=false}
   if(field.type==='select'){
    for(const opt of field.options||[]){
     const item=document.createElement('option');item.value=String(opt.value);item.textContent=opt.label;control.append(item);
    }
   }
   control.value=String(field.value??'');
   control.required=Boolean(field.required);
   if(field.readonly){control.readOnly=true;control.setAttribute('aria-readonly','true')}
   if(field.pattern&&control instanceof HTMLInputElement)control.pattern=field.pattern;
   const help=make('small','xm-studio-modal-help',field.help||'');
   const err=make('small','xm-studio-modal-error');err.setAttribute('role','alert');err.hidden=true;
   control.addEventListener('input',()=>{err.hidden=true;control.removeAttribute('aria-invalid');globalErr.hidden=true});
   wrap.append(label,control);
   if(cards){
    const buttons=[];
    const choices=make('div','xm-studio-modal-cardchoices');choices.setAttribute('role','group');choices.setAttribute('aria-label',field.label||field.name);
    for(const option of field.options||[]){
     const button=make('button','xm-studio-modal-choice');button.type='button';
     button.dataset.choice=String(option.value);
     button.setAttribute('aria-pressed',String(button.dataset.choice===control.value));
     button.append(make('strong','',option.label));
     if(option.description)button.append(make('small','',option.description));
     button.addEventListener('click',()=>{
      control.value=button.dataset.choice;
      for(const item of buttons)item.setAttribute('aria-pressed',String(item===button));
      err.hidden=true;globalErr.hidden=true;
     });
     buttons.push(button);choices.append(button);
    }
    wrap.append(choices);
   }
   if(field.help)wrap.append(help);
   wrap.append(err);grid.append(wrap);controls.set(field.name,{control,err,field});
  });
  if(fields.length)shell.append(grid);
  if(spec.notice){const notice=make('div','xm-studio-modal-notice',spec.notice);shell.append(notice)}
  const globalErr=make('p','xm-studio-modal-global-error');globalErr.hidden=true;globalErr.setAttribute('role','alert');shell.append(globalErr);
  const footer=make('div','xm-studio-modal-footer');
  const secondary=make('button','xm-studio-modal-cancel',spec.cancelLabel||'Отмена');secondary.type='button';
  const primary=make('button','xm-studio-modal-accept'+(spec.danger?' is-danger':''),spec.confirmLabel||'Продолжить');primary.type='submit';
  footer.append(secondary,primary);shell.append(footer);dlg.append(shell);
  let ended=false;
  const finish=value=>{if(ended)return;ended=true;dlg.close();dlg.remove();try{active?.focus?.({preventScroll:true})}catch{}resolve(value)};
  close.addEventListener('click',()=>finish(null));
  secondary.addEventListener('click',()=>finish(null));
  dlg.addEventListener('cancel',ev=>{ev.preventDefault();finish(null)});
  dlg.addEventListener('click',ev=>{if(ev.target===dlg)finish(null)});
  shell.addEventListener('submit',ev=>{
   ev.preventDefault();
   const values={};let firstBad=null;
   for(const [name,item] of controls){
    const {control,err,field}=item;
    const value=field.trim===false?control.value:control.value.trim();
    let message='';
    if(field.required&&!value)message='Заполните это поле';
    if(!message&&field.type==='number'&&(!Number.isInteger(Number(value))||(field.min!=null&&Number(value)<field.min)||(field.max!=null&&Number(value)>field.max)))message='Введите допустимое целое число';
    if(!message&&field.pattern&&!(new RegExp('^(?:'+field.pattern+')$')).test(value))message=field.patternMessage||'Проверьте формат значения';
    if(!message&&typeof field.validate==='function')message=field.validate(value,values)||'';
    if(message){err.textContent=message;err.hidden=false;control.setAttribute('aria-invalid','true');firstBad??=control}
    values[name]=value;
   }
   if(firstBad){firstBad.focus();return}
   if(typeof spec.validate==='function'){
    const message=spec.validate(values);
    if(message){globalErr.textContent=message;globalErr.hidden=false;return}
   }
   finish(values);
  });
  document.body.append(dlg);
  try{dlg.showModal()}catch(e){dlg.remove();resolve(null);return}
  const preferred=fields.length?controls.get(fields[0].name)?.control:primary;
  if(fields[0]?.type==='cards')grid.querySelector('.xm-studio-modal-choice[aria-pressed="true"]')?.focus();
  else preferred?.focus();
  if(fields.length&&spec.selectFirst!==false&&preferred.select)preferred.select();
 });
 const next=queue.then(run,run);
 queue=next.then(()=>{},()=>{});
 return next;
}
async function confirm(options){
 const result=await request({...options,fields:[],confirmLabel:options?.confirmLabel||'Подтвердить'});
 return result!==null;
}
return {request,confirm};
})();
