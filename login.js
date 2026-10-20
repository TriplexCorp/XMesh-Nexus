const form=document.querySelector('#login-form');
const button=document.querySelector('#submit');
const error=document.querySelector('#login-error');
const params=new URLSearchParams(location.search);
if(params.has('unavailable'))error.textContent='Сервис авторизации временно недоступен. Попробуйте ещё раз позже.';
(async()=>{
  try{
    const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store'});
    if(response.ok){const session=await response.json();if(session.authenticated)location.replace('/');}
  }catch(_){}
})();
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const username=form.elements.username.value.trim();
  const password=form.elements.password.value;
  button.disabled=true;
  button.textContent='Проверка…';
  error.textContent='';
  try{
    const response=await fetch('/api/v1/auth/login',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Не удалось войти.');
    form.elements.password.value='';
    location.replace('/');
  }catch(e){
    error.textContent=e.message||'Не удалось связаться с сервером.';
    button.disabled=false;
    button.textContent='Войти ↗';
  }
});
