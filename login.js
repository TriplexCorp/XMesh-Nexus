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
    if(response.ok){const session=await response.json();if(session.authenticated)location.replace('/');}
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
    } else {
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
    } else if(payload.authenticated===true) {
      form.elements.password.value='';
      mfaCode.value='';
      challenge=null;
      location.replace('/');
    } else throw new Error('Сервер не подтвердил вход.');
  }catch(e){
    error.textContent=e.message||'Не удалось связаться с сервером.';
    if(challenge)mfaCode.select();
  }finally{
    button.disabled=false;
    button.textContent=challenge?'Подтвердить вход':'Войти ↗';
  }
});
