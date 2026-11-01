'use strict';

// Guided XRAY STUDIO TLS editor. It deliberately intercepts only the TLS and
// quick-Hysteria toolbar actions; the rest of xray-studio-tools.js remains the
// authoritative tool implementation.
(()=>{
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const studioRoot=node=>node?.closest?.('#xm-studio-v4')||null;
 const sourceOf=root=>root?.querySelector?.('[data-v="source"]')||root?.querySelector?.('[data-xm="manual"]')||null;
 const selectedInbound=(root,doc)=>{
  const list=Array.isArray(doc?.inbounds)?doc.inbounds:[];
  if(!list.length)throw Error('В конфигурации нет inbound');
  const raw=root.querySelector('[data-tool-inbound]')?.value??root.querySelector('[data-field="inboundSelect"]')?.value??'0';
  const index=Number(raw);
  if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Некорректно выбран inbound');
  return {inbound:list[index],index};
 };
 function publish(root,message){
  const status=root?.querySelector?.('[data-tool-status]');
  if(status){status.textContent=message;status.dataset.tone='ok'}
 }
 function commit(root,source,doc,message){
  source.value=JSON.stringify(doc,null,2);
  source.dispatchEvent(new Event('input',{bubbles:true}));
  source.dispatchEvent(new Event('change',{bubbles:true}));
  publish(root,message);
 }
 function securityIcon(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6l-7-3Z"/><path d="M9 12l2 2 4-4"/></svg>'}
 function closeIcon(){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'}
 function certificateSummary(tls){
  const certs=Array.isArray(tls?.certificates)?tls.certificates:[];
  if(!certs.length)return {count:0,title:'Автоматически',text:'Ручной сертификат не закреплён. Managed TLS на ноде сможет подставить сертификат через подписанную policy.'};
  return {count:certs.length,title:certs.length===1?'1 сертификат':certs.length+' сертификата',text:'Текущий certificates сохраняется без изменений. Ручные пути доступны в Advanced JSON.'};
 }
 function tlsMode(tls,hysteria){
  if(hysteria)return '13';
  const min=String(tls?.minVersion||''),max=String(tls?.maxVersion||'');
  if(min==='1.3'&&max==='1.3')return '13';
  if(min==='1.2'&&max==='1.3')return '12-13';
  return 'auto';
 }
 function modeLabel(mode){return mode==='13'?'TLS 1.3':mode==='12-13'?'TLS 1.2–1.3':'Авто'}
 function openTls(root,source,doc,index){
  const inbound=doc.inbounds[index];
  const stream=inbound.streamSettings??={};
  const network=String(stream.network||stream.method||'raw').toLowerCase();
  const hysteria=String(inbound.protocol||'').toLowerCase()==='hysteria'||network==='hysteria';
  const tls=(stream.tlsSettings&&typeof stream.tlsSettings==='object'&&!Array.isArray(stream.tlsSettings))?clone(stream.tlsSettings):{certificates:[]};
  if(!Array.isArray(tls.certificates))tls.certificates=[];
  const initialAlpn=Array.isArray(tls.alpn)?tls.alpn.filter(v=>typeof v==='string'):[];
  const alpn=hysteria&&initialAlpn.length===0?['h3']:initialAlpn;
  const cert=certificateSummary(tls);
  const tag=String(inbound.tag||('inbound #'+(index+1)));
  const protocol=String(inbound.protocol||'—');
  const mode=tlsMode(tls,hysteria);
  const dialog=document.createElement('dialog');
  dialog.className='xm-tls-dialog';
  dialog.setAttribute('aria-labelledby','xm-tls-dialog-title');
  dialog.innerHTML=`<form method="dialog" class="xm-tls-shell" novalidate>
    <header class="xm-tls-head">
      <div class="xm-tls-head-main">
        <span class="xm-tls-mark">${securityIcon()}</span>
        <div class="xm-tls-head-copy"><span class="xm-tls-eyebrow">XRAY STUDIO / TLS</span><h2 id="xm-tls-dialog-title">Защита транспорта</h2><p>${esc(tag)} · ${esc(protocol)} / ${esc(network||'raw')}</p></div>
      </div>
      <button type="button" class="xm-tls-close" aria-label="Закрыть">${closeIcon()}</button>
    </header>
    <div class="xm-tls-body">
      ${hysteria?`<section class="xm-tls-hero"><div><span>HYSTERIA2 / QUIC</span><strong>TLS 1.3 + h3 закреплены протоколом</strong><p>Параметры транспорта останутся совместимыми с QUIC listener и не могут быть случайно ослаблены через форму.</p></div><b>LOCKED</b></section>`:''}
      <div class="xm-tls-layout">
        <aside class="xm-tls-summary" aria-label="Сводка TLS">
          <div class="xm-tls-summary-title"><span>ПРОФИЛЬ</span><strong>${esc(tag)}</strong><small>${esc(protocol)} · ${esc(network||'raw')}</small></div>
          <dl>
            <div><dt>Режим</dt><dd>${esc(modeLabel(mode))}</dd></div>
            <div><dt>ALPN</dt><dd>${esc(alpn.length?alpn.join(', '):'default')}</dd></div>
            <div><dt>SNI</dt><dd>${esc(tls.serverName||'не задан')}</dd></div>
            <div><dt>Reject SNI</dt><dd>${tls.rejectUnknownSni===true?'включён':'выключен'}</dd></div>
          </dl>
          <div class="xm-tls-cert-summary">
            <span class="xm-tls-cert-icon">${securityIcon()}</span>
            <div><small>СЕРТИФИКАТЫ</small><strong>${esc(cert.title)}</strong><p>${esc(cert.text)}</p></div>
            <b>${cert.count}</b>
          </div>
          <p class="xm-tls-summary-note">Форма меняет только документируемые TLS-поля. Неизвестные tlsSettings сохраняются через Advanced JSON.</p>
        </aside>

        <div class="xm-tls-settings">
          <section class="xm-tls-block">
            <div class="xm-tls-block-head"><div><span>01</span><h3>Версия TLS</h3></div><p>Выберите политику шифрования без ручного JSON.</p></div>
            <div class="xm-tls-version-grid" role="radiogroup" aria-label="Версия TLS">
              <label class="xm-tls-choice ${mode==='auto'?'is-selected':''}"><input type="radio" name="tlsMode" value="auto" ${mode==='auto'?'checked':''} ${hysteria?'disabled':''}><span><strong>Авто</strong><small>Xray / Go TLS default</small></span></label>
              <label class="xm-tls-choice ${mode==='12-13'?'is-selected':''}"><input type="radio" name="tlsMode" value="12-13" ${mode==='12-13'?'checked':''} ${hysteria?'disabled':''}><span><strong>1.2–1.3</strong><small>совместимый диапазон</small></span></label>
              <label class="xm-tls-choice ${mode==='13'?'is-selected':''}"><input type="radio" name="tlsMode" value="13" ${mode==='13'?'checked':''}><span><strong>1.3</strong><small>${hysteria?'обязательно для QUIC':'только современный TLS'}</small></span></label>
            </div>
          </section>

          <section class="xm-tls-block">
            <div class="xm-tls-block-head"><div><span>02</span><h3>ALPN</h3></div><p>Протокол внутри TLS handshake.</p></div>
            <div class="xm-tls-alpn-grid">
              ${[['h3','HTTP/3 / QUIC'],['h2','HTTP/2'],['http/1.1','HTTP/1.1']].map(([value,label])=>`<label class="xm-tls-alpn ${alpn.includes(value)?'is-selected':''} ${hysteria&&value!=='h3'?'is-disabled':''}"><input type="checkbox" value="${value}" ${alpn.includes(value)?'checked':''} ${hysteria?'disabled':''}><span><strong>${value}</strong><small>${label}</small></span></label>`).join('')}
            </div>
            <p class="xm-tls-hint">${hysteria?'Для Hysteria2 фиксируется только h3.':'Пустой выбор удалит поле alpn и оставит default Xray.'}</p>
          </section>

          <section class="xm-tls-block xm-tls-identity">
            <div class="xm-tls-block-head"><div><span>03</span><h3>Идентификация</h3></div><p>SNI и политика неизвестных имён.</p></div>
            <div class="xm-tls-identity-row">
              <label class="xm-tls-field"><span>Server Name (SNI)</span><input name="serverName" value="${esc(tls.serverName||'')}" placeholder="example.com"><small>Оставьте пустым, если inbound не требует SNI.</small></label>
              <label class="xm-tls-switch"><input type="checkbox" name="rejectUnknownSni" ${tls.rejectUnknownSni===true?'checked':''}><span class="xm-tls-switch-ui"></span><span><strong>Reject Unknown SNI</strong><small>Отклонять SNI, не соответствующий сертификату.</small></span></label>
            </div>
          </section>

          <details class="xm-tls-advanced"><summary><span><b>Advanced JSON</b><small>Неизвестные tlsSettings сохраняются</small></span><i>Открыть</i></summary><label><span>tlsSettings</span><textarea name="advanced" rows="10" spellcheck="false">${esc(JSON.stringify(tls,null,2))}</textarea></label><p class="xm-tls-json-error" role="alert" hidden></p></details>
        </div>
      </div>
    </div>
    <footer class="xm-tls-footer"><span>Изменения применяются только к выбранному inbound.</span><div><button type="button" class="xm-tls-cancel">Отмена</button><button type="submit" class="xm-tls-apply">Применить TLS</button></div></footer>
  </form>`;
  const form=dialog.querySelector('form'),error=dialog.querySelector('.xm-tls-json-error');
  const finish=()=>{if(dialog.open)dialog.close();dialog.remove()};
  dialog.querySelector('.xm-tls-close').addEventListener('click',finish);
  dialog.querySelector('.xm-tls-cancel').addEventListener('click',finish);
  dialog.addEventListener('cancel',ev=>{ev.preventDefault();finish()});
  dialog.addEventListener('click',ev=>{if(ev.target===dialog)finish()});
  dialog.querySelectorAll('.xm-tls-choice input,.xm-tls-alpn input').forEach(input=>input.addEventListener('change',()=>{
    const group=input.closest('.xm-tls-version-grid,.xm-tls-alpn-grid');
    group?.querySelectorAll('label').forEach(label=>label.classList.toggle('is-selected',Boolean(label.querySelector('input')?.checked)));
  }));
  form.addEventListener('submit',ev=>{
    ev.preventDefault();
    let advanced;
    try{advanced=JSON.parse(form.elements.advanced.value)}catch{error.textContent='Расширенный JSON содержит синтаксическую ошибку.';error.hidden=false;form.elements.advanced.focus();return}
    if(!advanced||typeof advanced!=='object'||Array.isArray(advanced)){error.textContent='tlsSettings должен быть JSON-объектом.';error.hidden=false;return}
    error.hidden=true;
    const next=clone(advanced);
    if(!Array.isArray(next.certificates))next.certificates=[];
    const serverName=form.elements.serverName.value.trim();
    if(serverName)next.serverName=serverName;else delete next.serverName;
    if(form.elements.rejectUnknownSni.checked)next.rejectUnknownSni=true;else delete next.rejectUnknownSni;
    if(hysteria){
      next.alpn=['h3'];next.minVersion='1.3';next.maxVersion='1.3';
    }else{
      const selected=[...form.querySelectorAll('.xm-tls-alpn input:checked')].map(el=>el.value);
      if(selected.length)next.alpn=selected;else delete next.alpn;
      const chosen=form.elements.tlsMode.value;
      if(chosen==='13'){next.minVersion='1.3';next.maxVersion='1.3'}
      else if(chosen==='12-13'){next.minVersion='1.2';next.maxVersion='1.3'}
      else{delete next.minVersion;delete next.maxVersion}
    }
    const live=JSON.parse(source.value);
    const current=live.inbounds?.[index];
    if(!current||String(current.tag||'')!==String(inbound.tag||'')){error.textContent='Inbound изменился во время редактирования. Откройте TLS заново.';error.hidden=false;return}
    current.streamSettings??={};current.streamSettings.security='tls';current.streamSettings.tlsSettings=next;
    commit(root,source,live,hysteria?'Hysteria2: TLS 1.3 / ALPN h3 применены к JSON':'TLS настройки применены к JSON');
    finish();
  });
  document.body.append(dialog);dialog.showModal();
 }
 function createHysteria(root,source){
  const doc=JSON.parse(source.value);doc.inbounds??=[];
  const base='hysteria-',used=new Set(doc.inbounds.map(item=>String(item?.tag||'')));
  let n=doc.inbounds.length+1;while(used.has(base+n))n++;
  doc.inbounds.push({tag:base+n,listen:'127.0.0.1',port:4433,protocol:'hysteria',settings:{version:2,users:[]},streamSettings:{network:'hysteria',security:'tls',hysteriaSettings:{version:2},tlsSettings:{alpn:['h3'],minVersion:'1.3',maxVersion:'1.3',certificates:[]}}});
  commit(root,source,doc,'Hysteria2 создан: TLS 1.3 / ALPN h3 установлены по умолчанию');
 }
 document.addEventListener('click',ev=>{
  const button=ev.target.closest?.('#xm-studio-v4 [data-tool]');if(!button)return;
  const action=button.dataset.tool;if(action!=='tls'&&action!=='hysteria')return;
  const root=studioRoot(button),source=sourceOf(root);if(!root||!source)return;
  ev.preventDefault();ev.stopImmediatePropagation();
  try{
    const doc=JSON.parse(source.value);
    if(action==='hysteria'){createHysteria(root,source);return}
    const {index}=selectedInbound(root,doc);openTls(root,source,doc,index);
  }catch(error){publish(root,error?.message||'Не удалось открыть TLS настройки')}
 },true);
})();
