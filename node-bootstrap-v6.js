'use strict';

// v6 product invariant: the panel must never hand a fresh VPS an installer
// that can enter operational state before strict-PQ activation is verified.
// Keep this SHA pinned to the reviewed XMesh-Node strict-PQ-only release.
const XMESH_V6_NODE_BOOTSTRAP_SHA='66d09bc2a9d7f131e2e4c931573bc8a116286e77';
const XMESH_V6_BOOTSTRAP_MARKER='XMesh Node v6 fresh installer. Security invariant:';
const XMESH_V6_XSP_IDENTITY_CONFLICT='XSP-v2 identity already enrolled: legacy re-enrollment cannot rotate it.';

async function xmeshV6StrictPqBootstrapClick(event){
  const button=event.target?.closest?.('[data-node-bootstrap]');
  if(!button)return;

  // app.js still contains the historical bootstrap handler. Capture this event
  // first so only the strict-PQ-only v6 flow can issue an installation command.
  event.preventDefault();
  event.stopImmediatePropagation();

  const id=Number(button.dataset.nodeBootstrap);
  if(!Number.isInteger(id)||id<=0){toast('Некорректный ID узла');return}
  if(location.protocol!=='https:'){toast('Для подключения требуется HTTPS');return}

  button.disabled=true;
  try{
    const enrollPath='/api/v1/nodes/'+encodeURIComponent(id)+'/enrollment';
    let issued=null;
    let reuseExistingIdentity=false;
    try{
      issued=await backendRequest(enrollPath,{method:'POST'});
    }catch(error){
      if(error.status!==409||!String(error.message||'').includes('already has a registered key'))throw error;
      const approved=await panelConfirm(panelIsEnglish()
        ? `Node #${id} already has an identity. Continue to repair/reconnect it. If it is legacy, this explicitly authorizes legacy re-enrollment. If it is already XSP-v2, no identity will be rotated: the panel will generate a same-VPS repair command that reuses the durable strict-PQ receipt. Do not use the tokenless repair path for a replacement VPS.`
        : `Узел #${id} уже зарегистрирован. Продолжить repair/переподключение? Для legacy identity это явно разрешит legacy re-enrollment. Если identity уже XSP-v2, она не будет ротироваться: панель выдаст repair-команду для той же VPS с переиспользованием durable strict-PQ receipt. Не используйте repair без токена для новой/заменённой VPS.`);
      if(!approved)return;
      try{
        issued=await backendRequest(enrollPath+'/reissue',{method:'POST'});
      }catch(reissueError){
        if(reissueError.status===409&&String(reissueError.message||'').includes(XMESH_V6_XSP_IDENTITY_CONFLICT)){
          reuseExistingIdentity=true;
        }else{
          throw reissueError;
        }
      }
    }

    if(!reuseExistingIdentity&&(!issued||!Number.isInteger(Number(issued.nodeId))||String(issued.token||'').length!==64)){
      throw new Error('Панель вернула некорректный одноразовый enrollment token');
    }

    const port=Number(DB.nodes.find(node=>Number(node.id)===id)?.port)||8443;
    const url='https://raw.githubusercontent.com/TriplexCorp/XMesh-Node/'+XMESH_V6_NODE_BOOTSTRAP_SHA+'/bootstrap.sh';
    const command='curl --proto "=https" --tlsv1.2 -H "Cache-Control: no-cache" -fsSLo /tmp/xmesh-bootstrap-v6.sh '+url+
      ' && grep -Fq "'+XMESH_V6_BOOTSTRAP_MARKER+'" /tmp/xmesh-bootstrap-v6.sh'+
      ' && sudo env XMESH_NODE_RELEASE_REF='+XMESH_V6_NODE_BOOTSTRAP_SHA+' bash /tmp/xmesh-bootstrap-v6.sh '+location.origin+' '+id+' '+port;
    const commandTitle=reuseExistingIdentity?'Команда repair для текущей VPS':'Команда для чистого VPS';
    const commandDescription=reuseExistingIdentity
      ?'Запустите только на той же VPS, где сохранена strict-PQ identity. Установщик сначала криптографически проверит durable activation receipt и не запросит новый enrollment token.'
      :'Скопируйте и запустите. Она скачивает и checkout’ит только pinned v6 strict-PQ release.';
    const identityNote=reuseExistingIdentity
      ?'<p class="note" role="alert"><strong>Identity сохраняется.</strong> Новый enrollment token не выдаётся и ключи не ротируются. Этот путь предназначен только для repair той же VPS с сохранённым <code>/var/lib/xmesh-agent/product/active.json</code>. Для новой/заменённой VPS требуется отдельный XSP-v2 recovery/rotation flow.</p>'
      :(issued.keyReplacementAuthorized?'<p class="note" role="alert">Recovery/reinstall: старая legacy identity останется действующей до успешного proof новой strict-PQ identity.</p>':'');
    const tokenSection=reuseExistingIdentity?'':
      '<section class="node-setup-step"><div class="node-setup-step-title"><span class="node-setup-number">2</span><div><h3>Одноразовый токен</h3><p>Вставьте его в скрытый запрос установщика. После этого enrollment → hybrid TLS → verified receipt выполняются автоматически до запуска Node/Xray.</p></div></div><input id="node-bootstrap-token" type="password" readonly autocomplete="off" aria-label="Одноразовый токен подключения" value="'+esc(issued.token)+'"><div class="node-setup-token-actions"><span>Действует 10 минут · одноразовый</span><button type="button" class="gh" data-copy-node-token>'+ic('copy')+'Скопировать токен</button></div></section>';

    modal('<div class="box node-setup"><div class="bar2 node-setup-head"><div><h2>POSTQUANTUM подключение узла</h2><p>Установщик fail-closed: Node/Xray не запустятся без подтверждённой strict-PQ активации.</p></div><button class="ia" data-x aria-label="Закрыть">'+ic('x')+'</button></div>'+
      '<section class="node-setup-step"><div class="node-setup-step-title"><span class="node-setup-number">1</span><div><h3>'+commandTitle+'</h3><p>'+commandDescription+'</p></div></div><textarea id="node-bootstrap-command" readonly spellcheck="false" rows="4" aria-label="Команда установки">'+esc(command)+'</textarea><button type="button" class="btn node-setup-copy" data-copy-node-bootstrap>'+ic('copy')+'Скопировать команду</button></section>'+
      identityNote+tokenSection+'</div>','wide');
  }catch(error){
    toast('Ошибка выдачи strict-PQ установки: '+(error.message||'API'));
  }finally{
    button.disabled=false;
  }
}

document.addEventListener('click',xmeshV6StrictPqBootstrapClick,true);
