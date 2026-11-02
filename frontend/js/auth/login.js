'use strict';

const APPEARANCE_DEFAULTS={
  theme:'dark',accent:'emerald',customA:'#60d6a2',customB:'#c3e879',
  ts:1,motion:1,density:'comfortable',surface:'solid',glow:'normal',
  font:'onest',radius:16,borders:'soft'
};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const contrastInk=hex=>{
  const match=String(hex||'').match(/^#([0-9a-f]{6})$/i);
  if(!match)return '#082b1d';
  const rgb=match[1].match(/../g).map(v=>parseInt(v,16)/255);
  const linear=rgb.map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
  return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]>.42?'#082b1d':'#ffffff';
};
function applySavedAppearance(){
  let saved={};
  try{saved=JSON.parse(localStorage.xmeshNexusSettings||'{}')||{}}catch(_){}
  const settings={...APPEARANCE_DEFAULTS,...saved};
  if(settings.accent==='mint')settings.accent='emerald';
  if(!['solid','glass','raised'].includes(settings.surface))settings.surface='solid';
  const root=document.documentElement;
  const theme=settings.theme==='auto'
    ?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')
    :(['dark','light'].includes(settings.theme)?settings.theme:'dark');
  root.dataset.theme=theme;
  root.dataset.accent=settings.accent||APPEARANCE_DEFAULTS.accent;
  root.dataset.density=settings.density||APPEARANCE_DEFAULTS.density;
  root.dataset.surface=settings.surface;
  root.dataset.glow=settings.glow||APPEARANCE_DEFAULTS.glow;
  root.dataset.font=settings.font||APPEARANCE_DEFAULTS.font;
  root.dataset.borders=settings.borders||APPEARANCE_DEFAULTS.borders;
  root.dataset.motion=settings.motion?'on':'off';
  root.style.setProperty('--custom-a',settings.customA||APPEARANCE_DEFAULTS.customA);
  root.style.setProperty('--custom-b',settings.customB||APPEARANCE_DEFAULTS.customB);
  root.style.setProperty('--ts',clamp(Number(settings.ts)||1,.9,2));
  const radius=clamp(Number.isFinite(Number(settings.radius))?Number(settings.radius):16,1,36);
  root.style.setProperty('--ui-radius',radius+'px');
  root.style.setProperty('--ui-control-radius',radius+'px');
  root.style.setProperty('--btn-text',root.dataset.accent==='custom'
    ?contrastInk(settings.customA||APPEARANCE_DEFAULTS.customA)
    :(theme==='light'?'#ffffff':'#082b1d'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f5f7fa':'#0a0e14');
}
applySavedAppearance();

window.addEventListener('DOMContentLoaded',()=>{
  const form=document.querySelector('#login-form');
  const button=document.querySelector('#submit');
  const error=document.querySelector('#login-error');
  const params=new URLSearchParams(location.search);
  const passwordStep=document.querySelector('#password-step');
  const mfaStep=document.querySelector('#mfa-step');
  const mfaBack=document.querySelector('#mfa-back');
  const mfaCode=document.querySelector('#mfa-code');
  let challenge=null;

  if(params.has('unavailable'))error.textContent='Сервис авторизации временно недоступен. Попробуйте ещё раз позже.';
  (async()=>{
    try{
      const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
      if(response.ok){const session=await response.json();if(session.authenticated)location.replace(location.pathname);}
    }catch(_){}
  })();

  function showMfa(next){
    passwordStep.hidden=!!next;
    mfaStep.hidden=!next;
    mfaBack.hidden=!next;
    form.elements.username.required=!next;
    form.elements.password.required=!next;
    mfaCode.required=!!next;
    button.textContent=next?'Подтвердить вход':'Войти ↗';
    error.textContent='';
    if(next)mfaCode.focus();
  }
  mfaBack.addEventListener('click',()=>{
    challenge=null;
    mfaCode.value='';
    form.elements.password.value='';
    showMfa(false);
    form.elements.username.focus();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    button.disabled=true;
    button.textContent='Проверка…';
    error.textContent='';
    try{
      let response;
      if(challenge){
        response=await fetch('/api/v1/auth/mfa/verify',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({challenge,code:mfaCode.value.trim()})
        });
      }else{
        response=await fetch('/api/v1/auth/login',{
          method:'POST',credentials:'same-origin',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({username:form.elements.username.value.trim(),password:form.elements.password.value})
        });
      }
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'Не удалось войти.');
      if(payload.mfaRequired===true){
        if(typeof payload.challenge!=='string'||!/^([0-9a-f]{64})$/.test(payload.challenge))
          throw new Error('Неверный ответ сервера двухфакторной аутентификации.');
        challenge=payload.challenge;
        form.elements.password.value='';
        showMfa(true);
      }else if(payload.authenticated===true){
        form.elements.password.value='';
        mfaCode.value='';
        challenge=null;
        location.replace(location.pathname);
      }else throw new Error('Сервер не подтвердил вход.');
    }catch(e){
      error.textContent=e.message||'Не удалось связаться с сервером.';
      if(challenge)mfaCode.select();
    }finally{
      button.disabled=false;
      button.textContent=challenge?'Подтвердить вход':'Войти ↗';
    }
  });
});
