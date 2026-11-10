'use strict';
// One shared compact Remark variable picker for Hosts and XRAY STUDIO.
// Values in the preview are examples only; actual rendering is server-side.
window.XMeshRemarkPicker=(()=>{
  const variables=Object.freeze([
    ['SERVER_IP','IPv4 публичного подключения'],
    ['SERVER_IPV6','IPv6 публичного подключения'],
    ['USERNAME','Имя пользователя'],
    ['DATA_USAGE','Использованный трафик'],
    ['DATA_LEFT','Остаток трафика'],
    ['DATA_LIMIT','Лимит трафика'],
    ['CDN_DATA_LEFT','Остаток отдельной CDN-квоты'],
    ['NODE_DATA_LEFT','Остаток индивидуального лимита этой ноды'],
    ['TRAFFIC_LEFT','Остаток по типу подключения: обычное или CDN'],
    ['DAYS_LEFT','Осталось дней'],
    ['TIME_LEFT','Осталось времени'],
    ['EXPIRE_DATE','Дата окончания'],
    ['JALALI_EXPIRE_DATE','Дата по календарю Джалали'],
    ['STATUS_TEXT','Статус пользователя'],
    ['STATUS_EMOJI','Настраиваемый эмодзи статуса'],
    ['PROTOCOL','Протокол подключения'],
    ['TRANSPORT','Транспорт']
  ]);
  const example=Object.freeze({
    SERVER_IP:'203.0.113.10',SERVER_IPV6:'2001:db8::10',
    USERNAME:'demo_user',DATA_USAGE:'2.50 ГБ',DATA_LEFT:'7.50 ГБ',
    DATA_LIMIT:'10.00 ГБ',CDN_DATA_LEFT:'3.25 ГБ',NODE_DATA_LEFT:'3.25 ГБ',TRAFFIC_LEFT:'3.25 ГБ',DAYS_LEFT:'12',TIME_LEFT:'12 д. 5 ч. 40 мин.',
    EXPIRE_DATE:'2026-12-01',JALALI_EXPIRE_DATE:'1405-09-10',
    STATUS_TEXT:'Активна',STATUS_EMOJI:'✅',PROTOCOL:'VLESS',TRANSPORT:'xhttp'
  });
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const preview=value=>String(value).replace(/\{([A-Z_]+)\}/g,(whole,key)=>
    Object.prototype.hasOwnProperty.call(example,key)?example[key]:whole).slice(0,300);
  const markup=()=>'<div class="remark-template-tools" data-remark-picker>'+
    '<details class="remark-template-details"><summary>Переменные Remark <span>Вставить в название сервера</span></summary>'+
    '<div class="remark-template-grid">'+variables.map(([name,description])=>
      '<button type="button" class="remark-template-token" data-remark-insert="'+name+
      '" title="'+esc(description)+'"><code>{'+name+'}</code><small>'+esc(description)+'</small></button>').join('')+
    '</div><p class="remark-template-note">Переменные заменяются при каждой выдаче подписки. Эмодзи статусов настраиваются в SUBSCRIPTION STUDIO. IPv4/IPv6 выводятся только при прямом подключении по публичному IP. TRAFFIC_LEFT сначала учитывает индивидуальную квоту ноды, затем CDN или общий лимит. Для неоднозначного назначения показывает —.</p></details>'+
    '<div class="remark-template-preview"><small>Пример для демо-пользователя</small><output data-remark-preview>—</output></div>'+
    '</div>';
  function bind(root,selector){
    if(!root||root.dataset.remarkPickerBound==='true')return;
    root.dataset.remarkPickerBound='true';
    const input=()=>root.querySelector(selector);
    const draw=()=>{
      const out=root.querySelector('[data-remark-preview]');
      if(out)out.textContent=preview(input()?.value||'')||'—';
    };
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-remark-insert]');
      if(!button||!root.contains(button))return;
      const field=input();if(!field)return;
      event.preventDefault();
      const token='{'+button.dataset.remarkInsert+'}';
      const start=Number.isInteger(field.selectionStart)?field.selectionStart:field.value.length;
      const end=Number.isInteger(field.selectionEnd)?field.selectionEnd:start;
      field.setRangeText(token,start,end,'end');
      field.dispatchEvent(new Event('input',{bubbles:true}));
      field.focus();
      draw();
    });
    root.addEventListener('input',event=>{if(event.target===input())draw()});
    draw();
  }
  return Object.freeze({variables,example,markup,preview,bind});
})();