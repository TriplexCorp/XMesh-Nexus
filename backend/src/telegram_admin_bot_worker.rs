//! Telegram Bot API long-polling runtime.
//! One elected PostgreSQL session polls; Telegram commands are accepted only
//! from configured numeric user IDs in private chats, never from group admins.
use crate::{AppState, telegram_admin_bot::{self, BotConfig, LEADER_LOCK_ID}};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Connection, Row};
use std::{time::Duration, fmt::Write as _};
use uuid::Uuid;

#[derive(Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
    callback_query: Option<TelegramCallback>,
}
#[derive(Deserialize)]
struct TelegramMessage {
    chat: TelegramChat,
    from: Option<TelegramUser>,
    text: Option<String>,
}
#[derive(Deserialize)]
struct TelegramChat {
    id: i64,
    #[serde(rename="type")]
    kind: String,
}
#[derive(Deserialize)]
struct TelegramUser {
    id: i64,
    is_bot: Option<bool>,
}
#[derive(Deserialize)]
struct TelegramCallback {
    id: String,
    from: TelegramUser,
    data: Option<String>,
    message: Option<TelegramMessage>,
}
#[derive(Deserialize)]
struct TelegramMe {
    id: i64,
    username: Option<String>,
}

const RATE_SCRIPT: &str = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],90) end; return n";

#[derive(Clone)]
struct BotApi {
    client: Client,
    token: String,
}

impl BotApi {
    // Telegram mandates the bot token in the URL. This URL is never included
    // in tracing spans, logs, returned errors or any browser response.
    async fn call(&self, method: &'static str, body: Value) -> Result<Value, &'static str> {
        let url = format!("https://api.telegram.org/bot{}/{method}",self.token);
        let response = self.client.post(url).json(&body).send().await.map_err(|_| "network_unavailable")?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err("telegram_token_invalid");
        }
        if !response.status().is_success() {
            return Err("telegram_api_unavailable");
        }
        let value: Value = response.json().await.map_err(|_| "telegram_api_unavailable")?;
        if value.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err("telegram_api_unavailable");
        }
        value.get("result").cloned().ok_or("telegram_api_unavailable")
    }

    async fn send(&self, chat: i64, text: &str, buttons: Value) -> Result<(), &'static str> {
        self.call("sendMessage",json!({
            "chat_id":chat,
            "text":text,
            "parse_mode":"HTML",
            "disable_web_page_preview":true,
            "reply_markup":{"inline_keyboard":buttons}
        })).await.map(|_| ())
    }

    async fn acknowledge(&self, id: &str) {
        let _ = self.call("answerCallbackQuery",json!({"callback_query_id":id})).await;
    }
}

fn buttons(rows: Vec<Vec<(&str,String)>>) -> Value {
    json!(rows.into_iter().map(|row| row.into_iter()
        .map(|(label,data)| json!({"text":label,"callback_data":data}))
        .collect::<Vec<_>>()).collect::<Vec<_>>())
}

fn escape(text: &str) -> String {
    text.chars().fold(String::new(),|mut out,c|{
        match c {
            '&'=>out.push_str("&amp;"),
            '<'=>out.push_str("&lt;"),
            '>'=>out.push_str("&gt;"),
            '"'=>out.push_str("&quot;"),
            '\''=>out.push_str("&#39;"),
            _=>out.push(c)
        }
        out
    })
}

fn menu_buttons() -> Value {
    buttons(vec![
        vec![("👥 Пользователи","v:users".into()),("📊 Статистика","v:stats".into())],
        vec![("🖥 Узлы","v:nodes".into()),("🔎 Поиск","v:search".into())],
        vec![("❔ Помощь","v:help".into())],
    ])
}

async fn home(api: &BotApi, chat: i64) -> Result<(), &'static str> {
    api.send(chat,
        "✦ <b>XMesh Nexus</b>\n\nАдминистративный центр управления VPN.\nБыстрые действия, понятный статус и подтверждение каждой опасной операции.\n\n<b>Выберите раздел:</b>",
        menu_buttons()).await
}

async fn stats(api: &BotApi, state: &AppState, chat: i64) -> Result<(), &'static str> {
    let row = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS total,
                COUNT(*) FILTER(WHERE data->>'disabled'='true')::BIGINT AS disabled,
                COUNT(*) FILTER(WHERE data->>'hold'='true')::BIGINT AS waiting
         FROM panel_records WHERE collection='users'"
    ).fetch_one(&state.pool).await.map_err(|_|"database_unavailable")?;
    let nodes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM panel_records WHERE collection='nodes'"
    ).fetch_one(&state.pool).await.map_err(|_|"database_unavailable")?;
    let total: i64 = row.try_get("total").map_err(|_|"database_unavailable")?;
    let disabled: i64 = row.try_get("disabled").map_err(|_|"database_unavailable")?;
    let waiting: i64 = row.try_get("waiting").map_err(|_|"database_unavailable")?;
    let active_candidates = total.saturating_sub(disabled).saturating_sub(waiting);
    let text = format!(
        "📊 <b>Сводка Nexus</b>\n\n👥 Пользователи: <b>{total}</b>\n🟢 Не отключены и не ожидают: <b>{active_candidates}</b>\n⏳ Ожидают первого подключения: <b>{waiting}</b>\n🔴 Отключены: <b>{disabled}</b>\n🖥 Ноды: <b>{nodes}</b>\n\n<i>Точная активность и расход доступны в карточке пользователя. Эти счётчики не являются количеством онлайн-соединений.</i>"
    );
    api.send(chat,&text,buttons(vec![vec![("🏠 Меню","v:menu".into())]])).await
}

async fn nodes(api: &BotApi, state: &AppState, chat: i64) -> Result<(), &'static str> {
    let rows = sqlx::query(
        "SELECT id, data->>'name' AS name, data->>'state' AS state
         FROM panel_records WHERE collection='nodes'
         ORDER BY id DESC LIMIT 12"
    ).fetch_all(&state.pool).await.map_err(|_|"database_unavailable")?;
    let mut message = String::from("🖥 <b>Ноды XMesh</b>\n\n");
    if rows.is_empty() {
        message.push_str("Ноды ещё не добавлены.");
    }
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|_|"database_unavailable")?;
        let name: Option<String> = row.try_get("name").map_err(|_|"database_unavailable")?;
        let status: Option<String> = row.try_get("state").map_err(|_|"database_unavailable")?;
        let state_label = match status.as_deref() {
            Some("ONLINE")|Some("online")=>"🟢",
            Some("OFFLINE")|Some("offline")=>"🔴",
            _=>"⚪",
        };
        let label = escape(name.as_deref().unwrap_or("Без названия"));
        let _ = writeln!(message,"{state_label} <b>{label}</b> · #{id}");
    }
    message.push_str("\n<i>Состояние из карточки ноды; не гарантирует свежесть heartbeat.</i>");
    api.send(chat,&message,menu_buttons()).await
}

async fn users(api: &BotApi, state: &AppState, chat: i64) -> Result<(), &'static str> {
    let rows = sqlx::query(
        "SELECT id,data->>'username' AS username FROM panel_records
         WHERE collection='users' ORDER BY id DESC LIMIT 8"
    ).fetch_all(&state.pool).await.map_err(|_|"database_unavailable")?;
    let mut message = String::from("👥 <b>Последние пользователи</b>\n\n");
    let mut controls=Vec::new();
    for row in rows {
        let id: i64=row.try_get("id").map_err(|_|"database_unavailable")?;
        let name: Option<String>=row.try_get("username").map_err(|_|"database_unavailable")?;
        let safe_name=escape(name.as_deref().unwrap_or("Без имени"));
        let _=writeln!(message,"• <b>{safe_name}</b> · #{id}");
        controls.push(vec![(format!("👤 {}", name.as_deref().unwrap_or("Пользователь").chars().take(24).collect::<String>()), format!("v:user:{id}"))]);
    }
    if controls.is_empty() { message.push_str("Пользователей пока нет.\n"); }
    message.push_str("\nПоиск: <code>/find имя</code> или <code>/user 123</code>");
    let mut keyboard=controls.into_iter().map(|row|row.into_iter().map(|(text,data)|json!({"text":text,"callback_data":data})).collect::<Vec<_>>()).collect::<Vec<_>>();
    keyboard.push(vec![json!({"text":"🏠 Меню","callback_data":"v:menu"})]);
    api.send(chat,&message,json!(keyboard)).await
}

async fn find(api: &BotApi, state: &AppState, chat: i64, term: &str) -> Result<(), &'static str> {
    let query=term.trim();
    if query.is_empty() || query.chars().count()>48 {
        return api.send(chat,"Введите часть имени: <code>/find username</code>",
            buttons(vec![vec![("🏠 Меню","v:menu".into())]])).await;
    }
    let pattern = format!("%{query}%");
    let rows=sqlx::query(
        "SELECT id,data->>'username' AS username FROM panel_records
         WHERE collection='users' AND data->>'username' ILIKE $1
         ORDER BY id DESC LIMIT 12"
    ).bind(pattern).fetch_all(&state.pool).await.map_err(|_|"database_unavailable")?;
    let mut text=format!("🔎 <b>Результаты: {}</b>\n\n",escape(query));
    let mut keyboard=Vec::new();
    for row in rows {
        let id:i64=row.try_get("id").map_err(|_|"database_unavailable")?;
        let name:Option<String>=row.try_get("username").map_err(|_|"database_unavailable")?;
        let username=name.unwrap_or_else(||"Без имени".to_owned());
        let _=writeln!(text,"• <b>{}</b> · #{id}",escape(&username));
        keyboard.push(vec![json!({"text":format!("👤 {}",username.chars().take(24).collect::<String>()),"callback_data":format!("v:user:{id}")})]);
    }
    if keyboard.is_empty() {text.push_str("Ничего не найдено.");}
    keyboard.push(vec![json!({"text":"🏠 Меню","callback_data":"v:menu"})]);
    api.send(chat,&text,json!(keyboard)).await
}

async fn user_card(api: &BotApi, state: &AppState, chat: i64, id: i64) -> Result<(), &'static str> {
    let record=sqlx::query_scalar::<_,Value>(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1"
    ).bind(id).fetch_optional(&state.pool).await.map_err(|_|"database_unavailable")?;
    let Some(mut user)=record else {
        return api.send(chat,"Пользователь не найден.",menu_buttons()).await;
    };
    let extra=crate::user_metered_bytes(&state.pool,id).await.map_err(|_|"database_unavailable")?;
    crate::add_metered_usage(&mut user,extra);
    let username=escape(user.get("username").and_then(Value::as_str).unwrap_or("Без имени"));
    let disabled=user.get("disabled")==Some(&Value::Bool(true));
    let status=crate::user_status(&user,telegram_admin_bot::now_ms());
    let used=user.get("used").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
    let limit=user.get("limit").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
    let expiry=user.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
    let remain=if expiry>0 {(expiry-telegram_admin_bot::now_ms()).max(0)/86_400_000} else {-1};
    let deadline=if user.get("hold")==Some(&Value::Bool(true)) {
        "С первого подключения".to_owned()
    } else if remain<0 {
        "Без срока".to_owned()
    } else {
        format!("{remain} дн.")
    };
    let traffic=if limit>0.0 {format!("{used:.2} / {limit:.2} ГБ")} else {format!("{used:.2} ГБ / ∞")};
    let message=format!(
        "👤 <b>{username}</b>\n\nID: <code>{id}</code>\nСтатус: <b>{status}</b>\nТрафик: <b>{traffic}</b>\nОсталось: <b>{deadline}</b>\n\n<i>Изменения доступа выполняются только после подтверждения.</i>"
    );
    let toggle=if disabled {("🟢 Включить",format!("v:ask:enable:{id}"))}
        else {("🔴 Отключить",format!("v:ask:disable:{id}"))};
    api.send(chat,&message,buttons(vec![
        vec![(toggle.0,toggle.1)],
        vec![("🔄 Обновить",format!("v:user:{id}")),("🏠 Меню","v:menu".into())],
    ])).await
}

async fn create_confirmation(
    api: &BotApi, state: &AppState, chat: i64, admin_id: i64,
    action: &str, user_id: i64,
) -> Result<(), &'static str> {
    if !matches!(action,"enable"|"disable") || user_id<=0 {
        return Err("invalid_command");
    }
    let nonce=Uuid::new_v4();
    sqlx::query(
        "INSERT INTO telegram_admin_bot_actions(nonce,admin_id,user_id,action,expires_at)
         VALUES($1::UUID,$2,$3,$4,NOW()+INTERVAL '60 seconds')"
    ).bind(nonce.to_string()).bind(admin_id).bind(user_id).bind(action)
    .execute(&state.pool).await.map_err(|_|"database_unavailable")?;
    let verb=if action=="enable" {"включить"} else {"отключить"};
    let text=format!(
        "⚠️ <b>Подтверждение действия</b>\n\nВы действительно хотите <b>{verb}</b> пользователя <code>#{user_id}</code>?\n\nПодтверждение действует 60 секунд и может быть использовано только один раз."
    );
    api.send(chat,&text,buttons(vec![
        vec![("✅ Подтвердить",format!("x:{nonce}"))],
        vec![("Отмена",format!("v:user:{user_id}"))],
    ])).await
}

async fn consume_confirmation(
    api: &BotApi,state: &AppState,chat:i64,admin_id:i64,raw:&str,
) -> Result<(), &'static str> {
    let nonce=Uuid::parse_str(raw).map_err(|_|"invalid_command")?;
    let mut tx=state.pool.begin().await.map_err(|_|"database_unavailable")?;
    let row=sqlx::query(
        "SELECT user_id,action FROM telegram_admin_bot_actions
         WHERE nonce=$1::UUID AND admin_id=$2 AND consumed_at IS NULL
           AND expires_at>NOW() FOR UPDATE"
    ).bind(nonce.to_string()).bind(admin_id)
    .fetch_optional(&mut *tx).await.map_err(|_|"database_unavailable")?;
    let Some(row)=row else {
        return api.send(chat,"⏳ Подтверждение истекло или уже использовано.",menu_buttons()).await;
    };
    let user_id:i64=row.try_get("user_id").map_err(|_|"database_unavailable")?;
    let action:String=row.try_get("action").map_err(|_|"database_unavailable")?;
    let record=sqlx::query(
        "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE"
    ).bind(user_id).fetch_optional(&mut *tx).await.map_err(|_|"database_unavailable")?;
    let Some(record)=record else {
        return api.send(chat,"Пользователь больше не существует.",menu_buttons()).await;
    };
    let mut data:Value=record.try_get("data").map_err(|_|"database_unavailable")?;
    let disabled=action=="disable";
    let changed=data.get("disabled")!=Some(&Value::Bool(disabled));
    if changed {
        data["disabled"]=json!(disabled);
        crate::validate_record("users",&data).map_err(|_|"invalid_user")?;
        sqlx::query(
            "UPDATE panel_records SET data=$2,updated_at=NOW()
             WHERE collection='users' AND id=$1"
        ).bind(user_id).bind(&data)
        .execute(&mut *tx).await.map_err(|_|"database_unavailable")?;
    }
    sqlx::query("UPDATE telegram_admin_bot_actions SET consumed_at=NOW() WHERE nonce=$1::UUID")
        .bind(nonce.to_string()).execute(&mut *tx)
        .await.map_err(|_|"database_unavailable")?;
    sqlx::query(
        "INSERT INTO panel_audit_log(actor,action,collection,record_id,detail)
         VALUES($1,$2,'users',$3,$4)"
    ).bind(format!("telegram:{admin_id}"))
     .bind(if disabled {"telegram_bot.user_disabled"} else {"telegram_bot.user_enabled"})
     .bind(user_id).bind(json!({"telegramAdminId":admin_id,"changed":changed}))
     .execute(&mut *tx).await.map_err(|_|"database_unavailable")?;
    tx.commit().await.map_err(|_|"database_unavailable")?;
    let text=if disabled {"🔴 Пользователь отключён."} else {"🟢 Пользователь включён."};
    api.send(chat,text,buttons(vec![
        vec![("👤 Карточка",format!("v:user:{user_id}"))],
        vec![("🏠 Меню","v:menu".into())]
    ])).await
}

async fn rate_limit(state:&AppState, id:i64)->bool {
    let minute=telegram_admin_bot::now_ms().div_euclid(60_000);
    let mut connection=state.redis.clone();
    let result=redis::cmd("EVAL")
        .arg(RATE_SCRIPT).arg(1)
        .arg(format!("xmesh:telegram-admin:{id}:{minute}"))
        .query_async::<i64>(&mut connection).await;
    matches!(result,Ok(n) if n <= 90)
}

async fn authorized(state:&AppState, revision:i64, user_id:i64)->bool {
    if user_id<=0 {return false;}
    let row=sqlx::query_scalar::<_,bool>(
        "SELECT enabled AND revision=$1 AND $2=ANY(admin_ids)
         FROM telegram_admin_bot WHERE singleton=TRUE"
    ).bind(revision).bind(user_id).fetch_optional(&state.pool).await;
    matches!(row,Ok(Some(true)))
}

async fn handle_command(
    api:&BotApi,state:&AppState,chat:i64,
    admin_id:i64,command:&str
)->Result<(),&'static str>{
    let raw=command.trim();
    let (cmd,arg)=raw.split_once(' ').map_or((raw,""),|(a,b)|(a,b.trim()));
    let cmd=cmd.split('@').next().unwrap_or("");
    match cmd {
        "/start"|"/menu"|"/help" => home(api,chat).await,
        "/stats" => stats(api,state,chat).await,
        "/users" => users(api,state,chat).await,
        "/nodes" => nodes(api,state,chat).await,
        "/find" => find(api,state,chat,arg).await,
        "/user" => match arg.parse::<i64>() {
            Ok(id) if id>0 => user_card(api,state,chat,id).await,
            _ => api.send(chat,"Используйте <code>/user 123</code>",menu_buttons()).await
        },
        // No commands can change access without first issuing a short-lived
        // single-use confirmation nonce to this exact administrator.
        "/enable"|"/disable" => match arg.parse::<i64>() {
            Ok(id) if id>0 => create_confirmation(
                api,state,chat,admin_id,&cmd[1..],id
            ).await,
            _=>api.send(chat,"Используйте <code>/disable 123</code> или <code>/enable 123</code>",menu_buttons()).await
        },
        _ => api.send(chat,
            "Команды:\n/start — меню\n/stats — сводка\n/users — пользователи\n/nodes — ноды\n/find имя — поиск\n/user ID — карточка\n\nВсе изменения доступа требуют отдельного подтверждения.",
            menu_buttons()).await
    }
}

async fn handle_callback(
    api:&BotApi,state:&AppState,chat:i64,admin_id:i64,data:&str,
)->Result<(),&'static str>{
    if data=="v:menu" {return home(api,chat).await;}
    if data=="v:stats" {return stats(api,state,chat).await;}
    if data=="v:users" {return users(api,state,chat).await;}
    if data=="v:nodes" {return nodes(api,state,chat).await;}
    if data=="v:search" {
        return api.send(chat,"🔎 Чтобы найти пользователя, отправьте:\n<code>/find имя</code>\nили\n<code>/user 123</code>",menu_buttons()).await;
    }
    if data=="v:help" {
        return handle_command(api,state,chat,admin_id,"/help").await;
    }
    if let Some(id)=data.strip_prefix("v:user:").and_then(|v|v.parse::<i64>().ok())
        && id>0 {
        return user_card(api,state,chat,id).await;
    }
    if let Some(other)=data.strip_prefix("v:ask:") {
        let mut parts=other.split(':');
        if let (Some(action),Some(raw_id),None)=(parts.next(),parts.next(),parts.next())
            && let Ok(id)=raw_id.parse::<i64>()
            && id>0 {
            return create_confirmation(api,state,chat,admin_id,action,id).await;
        }
    }
    if let Some(nonce)=data.strip_prefix("x:") {
        return consume_confirmation(api,state,chat,admin_id,nonce).await;
    }
    Err("invalid_command")
}

async fn dispatch(
    api:&BotApi,state:&AppState,revision:i64,update:TelegramUpdate,
) -> Result<(), &'static str> {
    if let Some(message)=update.message {
        let Some(user)=message.from else {return Ok(());};
        if message.chat.kind!="private" || message.chat.id!=user.id
            || user.is_bot.unwrap_or(false)
            || !authorized(state,revision,user.id).await {
            return Ok(());
        }
        if !rate_limit(state,user.id).await {return Ok(());}
        let text=message.text.unwrap_or_default();
        return handle_command(api,state,message.chat.id,user.id,&text).await;
    }
    if let Some(callback)=update.callback_query {
        let Some(message)=callback.message else {return Ok(());};
        if message.chat.kind!="private" || message.chat.id!=callback.from.id
            || callback.from.is_bot.unwrap_or(false)
            || !authorized(state,revision,callback.from.id).await {
            return Ok(());
        }
        if !rate_limit(state,callback.from.id).await {return Ok(());}
        api.acknowledge(&callback.id).await;
        if let Some(data)=callback.data.as_deref() {
            return handle_callback(api,state,message.chat.id,callback.from.id,data).await;
        }
    }
    Ok(())
}

async fn set_status(state:&AppState,rev:i64,identity:Option<&TelegramMe>,error:Option<&str>) {
    let name=identity.and_then(|me|me.username.as_deref());
    let id=identity.map(|me|me.id);
    let _=sqlx::query(
        "UPDATE telegram_admin_bot SET
         bot_id=COALESCE($2,bot_id),
         bot_username=COALESCE($3,bot_username),
         last_connected_at=CASE WHEN $4::TEXT IS NULL THEN NOW() ELSE last_connected_at END,
         last_error=$4
         WHERE singleton=TRUE AND revision=$1"
    ).bind(rev).bind(id).bind(name).bind(error)
    .execute(&state.pool).await;
}

async fn session(state:&AppState,client:&Client,config:&BotConfig)->Result<(), &'static str>{
    let Some(ciphertext)=config.ciphertext.as_ref() else {return Ok(());};
    let token=telegram_admin_bot::decrypt(state,ciphertext).map_err(|_|"decrypt_failed")?;
    if !telegram_admin_bot::validate_token(&token) {return Err("telegram_token_invalid");}
    let api=BotApi{client:client.clone(),token};
    let identity=api.call("getMe",json!({})).await?;
    let me:TelegramMe=serde_json::from_value(identity).map_err(|_|"telegram_api_unavailable")?;
    if me.id<=0 {return Err("telegram_api_unavailable");}
    // Dedicated bot, no public webhook required. Never discard Telegram updates.
    api.call("deleteWebhook",json!({"drop_pending_updates":false})).await?;
    set_status(state,config.revision,Some(&me),None).await;
    let mut offset=config.last_update_id;
    loop {
        let latest=telegram_admin_bot::load(state).await.map_err(|_|"database_unavailable")?;
        if !latest.enabled || latest.revision!=config.revision {return Ok(());}
        let data=api.call("getUpdates",json!({
            "offset":offset.saturating_add(1),
            "limit":30,
            "timeout":15,
            "allowed_updates":["message","callback_query"]
        })).await?;
        let updates:Vec<TelegramUpdate>=serde_json::from_value(data).map_err(|_|"telegram_api_unavailable")?;
        set_status(state,config.revision,Some(&me),None).await;
        for update in updates {
            if update.update_id<=offset {continue;}
            let next_offset=update.update_id;
            // Permission is checked again against the latest config per update.
            // A failed send never repeats a successfully committed access mutation.
            if let Err(code)=dispatch(&api,state,config.revision,update).await {
                if code=="database_unavailable" {return Err(code);}
            }
            sqlx::query(
                "UPDATE telegram_admin_bot SET last_update_id=GREATEST(last_update_id,$2)
                 WHERE singleton=TRUE AND revision=$1"
            ).bind(config.revision).bind(next_offset).execute(&state.pool)
                .await.map_err(|_|"database_unavailable")?;
            offset=next_offset;
        }
    }
}

pub(crate) async fn run(state:AppState){
    let client=match Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build() {
        Ok(c)=>c,
        Err(_)=>return,
    };
    loop {
        let config=telegram_admin_bot::load(&state).await;
        if let Ok(config)=config && config.enabled && !config.admins.is_empty() {
            if let Ok(mut lock)=state.pool.acquire().await {
                let leader=sqlx::query_scalar::<_,bool>(
                    "SELECT pg_try_advisory_lock($1)"
                ).bind(LEADER_LOCK_ID).fetch_one(&mut *lock).await;
                if matches!(leader,Ok(true)) {
                    let result=session(&state,&client,&config).await;
                    if let Err(code)=result {
                        // Only bounded fixed status codes; never log Telegram API
                        // responses, token-bearing URLs or remote error strings.
                        set_status(&state,config.revision,None,Some(code)).await;
                    }
                    // Unlock on the same connection. On failed unlock the
                    // connection is CLOSED rather than returned to the pool.
                    let unlocked=sqlx::query_scalar::<_,bool>(
                        "SELECT pg_advisory_unlock($1)"
                    ).bind(LEADER_LOCK_ID).fetch_one(&mut *lock).await;
                    if !matches!(unlocked,Ok(true)) {
                        let _=lock.close().await;
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(4)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn html_escaping_never_interprets_usernames() {
        assert_eq!(escape("<script>x&\"'</script>"),"&lt;script&gt;x&amp;&quot;&#39;&lt;/script&gt;");
    }
    #[test]
    fn callback_names_do_not_leak_secrets() {
        assert!(!format!("{:?}",menu_buttons()).contains("bot123:"));
        assert_eq!(Uuid::parse_str(&Uuid::new_v4().to_string()).is_ok(),true);
    }
}
