'use strict';
/* Small late-render consistency layer.
 * The canonical catalog remains core/i18n.js. This file covers dynamic copy
 * whose text contains runtime counts/identifiers and therefore cannot be
 * represented by the exact-string catalog without scattering language checks. */
(() => {
  const api=window.XMeshI18n;
  if(!api)return;
  const exact=new Map(Object.entries({
    'Балансировщики':'Balancers',
    'Обновления XMesh Nexus':'XMesh Nexus updates',
    'Подробная статистика':'Detailed statistics',
    'История трафика':'Traffic history',
    'Inbound и ноды':'Inbounds & nodes',
    'Измерения':'Measurements',
    'Подтверждённый Upload · накопленный':'Verified upload · total',
    'Подтверждённый Download · накопленный':'Verified download · total',
    'Всего · накоплено':'Total accumulated',
    'Ноды с учётом':'Nodes reporting',
    'Источник трафика':'Traffic source',
    'Распределение по нодам':'By node',
    'Качество данных':'Data quality',
    'По серверам':'By server',
    'Персональный трафик Xray':'Per-user Xray traffic',
    'Трафик по inbound':'Traffic by inbound',
    'Период рейтинга':'Ranking period',
    'Открыть любого пользователя по ID':'Open user by ID',
    'Открыть карточку':'Open user',
    'Скорость сети нод':'Node network throughput',
    'Top-10: подтверждённый трафик за период':'Top 10 verified traffic',
    'Получение измерений…':'Loading measurements…',
    'Ожидание измерений':'Waiting for measurements',
    'Обновление измерений…':'Refreshing measurements…',
    'Запрашиваем подтверждённую историю…':'Loading verified history…',
    'Загружаем данные…':'Loading data…',
    'Загружаем ссылку…':'Loading link…',
    'Нет подтверждённых измерений по нодам':'No verified node measurements',
    'Все поля доступны сразу':'All fields are directly editable',
    'Постоянная ссылка на подписку. Домен, путь, оформление и приложения управляются в SUBSCRIPTION STUDIO.':'Persistent subscription link. Domain, path, appearance and apps are managed in SUBSCRIPTION STUDIO.',
    'Только фактически подписанные измерения узлов; не прибавляются повторно к общему трафику пользователя.':'Only signed node measurements; they are not added again to the user total.',
    'RX/TX сетевых интерфейсов (включая сторонние сервисы), отдельно от персональных Xray-счётчиков.':'Network interface RX/TX, separate from per-user Xray counters.',
    'Только подтверждённые изменения Xray за выбранный период. Пользовательские и inbound-счётчики независимы и не складываются.':'Verified Xray deltas for the selected period. User and inbound counters are independent.'
  }));
  const patterns=[
    [/^Последняя точка TimescaleDB:\s*(.+?)\s+назад$/u,(_,v)=>'Latest TimescaleDB sample: '+v+' ago'],
    [/^Телеметрия:\s*(\d+)\s+свежих\s*·\s*(\d+)\s+задержанных\s*·\s*(\d+)\s+устаревших\/недостоверных\s*·\s*(\d+)\s+без измерений\.\s*Персональные Xray-счётчики подтверждены на\s*(\d+)\s+нодах?\.?/u,
      (_,fresh,delayed,stale,missing,verified)=>`Telemetry: ${fresh} fresh · ${delayed} delayed · ${stale} stale/invalid · ${missing} missing · Xray verified on ${verified} nodes`],
    [/^Создан\s+(.+)$/u,(_,v)=>'Created '+v],
    [/^Администратор:\s*(.+)$/u,(_,v)=>'Administrator: '+v],
    [/^Осталось\s+(.+)$/u,(_,v)=>'Remaining '+v],
    [/^(\d+)\s+дн$/u,(_,v)=>v+' days'],
    [/^Нода\s+#(\d+)$/u,(_,v)=>'Node #'+v]
  ];
  const translate=value=>{
    const text=String(value??'');
    const direct=exact.get(text);
    if(direct)return direct;
    for(const [pattern,render] of patterns){const match=text.match(pattern);if(match)return render(...match)}
    return text;
  };
  const skip=el=>el?.closest?.('code,pre,textarea,script,style,[contenteditable="true"]');
  const translateNode=node=>{
    if(api.getLanguage()!=='en'||!node||skip(node.parentElement))return;
    const raw=node.nodeValue||'';
    const trimmed=raw.trim();
    if(!trimmed)return;
    const next=translate(trimmed);
    if(next!==trimmed)node.nodeValue=raw.replace(trimmed,next);
  };
  const translateAttrs=el=>{
    if(api.getLanguage()!=='en'||!(el instanceof Element)||skip(el))return;
    for(const attr of ['title','aria-label','placeholder']){
      if(!el.hasAttribute(attr))continue;
      const value=el.getAttribute(attr)||'';
      const next=translate(value);
      if(next!==value)el.setAttribute(attr,next);
    }
  };
  const walk=root=>{
    if(api.getLanguage()!=='en'||!root)return;
    if(root.nodeType===Node.TEXT_NODE){translateNode(root);return}
    if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return;
    if(root.nodeType===Node.ELEMENT_NODE)translateAttrs(root);
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    let node;while((node=walker.nextNode()))node.nodeType===Node.TEXT_NODE?translateNode(node):translateAttrs(node);
  };
  const observer=new MutationObserver(records=>{
    if(api.getLanguage()!=='en')return;
    for(const record of records){
      if(record.type==='characterData')translateNode(record.target);
      for(const node of record.addedNodes)walk(node);
    }
  });
  const start=()=>{walk(document.body);observer.observe(document.body,{subtree:true,childList:true,characterData:true})};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
  /* The canonical runtime owns language state. Capture the UI action only to
   * re-scan already-mounted nodes that did not mutate during the switch. */
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('[data-panel-language="en"]'))return;
    setTimeout(()=>walk(document.body),0);
  },true);
  window.XMeshI18nConsistency=Object.freeze({translate,exact});
})();
