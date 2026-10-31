'use strict';

/* New-user dialog presentation override.
 * Loaded after app.js so the existing submit/template/generator handlers remain
 * authoritative while this file only replaces the form composition. */
(() => {
  const defaults={limit:0,days:0,strategy:'NO_RESET',hwid:0,squads:[]};
  const spec=key=>FU.find(item=>item.k===key);
  const decorate=(key,value=defaults[key],extra='')=>{
    const markup=field(spec(key),value);
    return markup.replace('class="f"',`class="f user-create-field ${extra}`.trim());
  };

  userNew=function userNewRedesigned(){
    if(!DB.squads.length){
      modal(`<div class="box"><h2>Сначала создайте сквад</h2><p class="note">Пользователю нужно назначить группу доступа. Создайте сквад, а затем вернитесь к созданию пользователя.</p><div class="act"><button class="gh" data-x>Отмена</button><button class="btn" data-ne="squads">${ic('plus')}Создать сквад</button></div></div>`);
      return;
    }

    const username=decorate('username','', 'user-create-username');
    const xrayProfile=decorate('xrayProfileId','', 'user-create-xray');
    const limit=decorate('limit',0,'user-create-limit');
    const days=decorate('days',0,'user-create-days');
    const strategy=decorate('strategy','NO_RESET','user-create-strategy');
    const hwid=decorate('hwid',0,'user-create-hwid');
    const tag=decorate('tag','', 'user-create-tag');
    const squads=decorate('squads',[], 'user-create-squads');
    const hold=decorate('hold',false,'user-create-hold');

    modal(`<form class="box user-create-dialog" data-k="user" method="dialog">
      <header class="user-create-head">
        <div class="user-create-title-wrap">
          <span class="user-create-title-icon">${ic('users')}</span>
          <div><h2>Новый пользователь</h2><p>Создайте пользователя и задайте параметры доступа</p></div>
        </div>
        <button type="button" class="user-create-close" data-x aria-label="Закрыть">${ic('x')}</button>
      </header>

      <div class="user-create-body">
        <section class="user-create-section user-create-section-main">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('layers')}</span>
            <div><h3>Основные настройки</h3><p>Базовые параметры пользователя</p></div>
          </div>
          <div class="user-create-main-grid">
            <label class="f user-create-field user-create-template">
              <span>Шаблон</span>
              <select id="tplsel"><option value="">Без шаблона</option>${DB.tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
              <small>При необходимости подставит параметры из сохранённого шаблона</small>
            </label>
            <div class="user-create-username-row">
              ${username}
              <button type="button" class="gh user-create-generate" data-generate-username title="Сгенерировать случайное уникальное имя" aria-label="Сгенерировать имя пользователя">${ic('redo')}<span>Сгенерировать</span></button>
            </div>
            ${xrayProfile}
          </div>
        </section>

        <section class="user-create-section user-create-section-limits">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('activity')}</span>
            <div><h3>Ограничения</h3><p>Лимиты и срок действия</p></div>
          </div>
          <div class="user-create-limits-grid">${limit}${days}${strategy}${hwid}</div>
        </section>

        <section class="user-create-section user-create-section-extra">
          <div class="user-create-section-head">
            <span class="user-create-section-icon">${ic('sliders')}</span>
            <div><h3>Дополнительно</h3><p>Опции и служебная информация</p></div>
          </div>
          <div class="user-create-extra-grid">
            ${tag}
            ${squads}
            ${hold}
            <label class="f user-create-field user-create-desc">
              <span>Заметка</span>
              <textarea name="desc" rows="3" placeholder="Добавьте заметку (необязательно)" autocomplete="off"></textarea>
            </label>
          </div>
        </section>

        <p class="er user-create-error" id="fe"></p>
      </div>

      <footer class="user-create-footer">
        <button type="button" class="gh user-create-cancel" data-x>Отмена</button>
        <button class="btn user-create-submit">${ic('plus')}<span>Создать пользователя</span></button>
      </footer>
    </form>`,'user-create-modal');

    setTimeout(()=>$('[name=username]')?.focus(),60);
  };
})();
