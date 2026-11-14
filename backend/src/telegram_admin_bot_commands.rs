//! Authenticated bilingual onboarding and bounded administrator actions.
//! Every mutation is a separate one-use confirmation transaction.
use super::locale::{Language, tr};
use super::{AppState, BotApi, buttons, escape};
use serde_json::{Map, Value, json};
use sqlx::{Postgres, Row, Transaction};
use std::fmt::Write as _;
use uuid::Uuid;

pub(super) async fn language(state: &AppState, id: i64) -> Result<Option<Language>, &'static str> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT language FROM telegram_admin_bot_preferences WHERE admin_id=$1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| "database_unavailable")?;
    Ok(row.as_deref().and_then(Language::from_db))
}

pub(super) async fn set_language(
    state: &AppState,
    id: i64,
    language: Language,
) -> Result<(), &'static str> {
    sqlx::query(
        "INSERT INTO telegram_admin_bot_preferences(admin_id,language)
         VALUES($1,$2) ON CONFLICT(admin_id) DO UPDATE
         SET language=EXCLUDED.language,updated_at=NOW()",
    )
    .bind(id)
    .bind(language.code())
    .execute(&state.pool)
    .await
    .map_err(|_| "database_unavailable")?;
    Ok(())
}

pub(super) async fn choose_language(api: &BotApi, chat: i64) -> Result<(), &'static str> {
    api.send(chat,"🌐 <b>Выберите язык / Choose your language</b>\n\nЭто язык административного бота.\nThis sets your admin bot language.",
        buttons(vec![
            vec![("🇷🇺 Русский","v:lang:ru".into())],
            vec![("🇬🇧 English","v:lang:en".into())],
        ])).await
}

pub(super) async fn squads(api: &BotApi, state: &AppState, chat: i64) -> Result<(), &'static str> {
    let rows = sqlx::query(
        "SELECT id,data->>'name' AS name FROM panel_records
         WHERE collection='squads' ORDER BY id DESC LIMIT 12",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| "database_unavailable")?;
    let mut text = tr(
        api.language,
        "🗂 <b>Сквады XMesh</b>\n\n",
        "🗂 <b>XMesh squads</b>\n\n",
    )
    .to_owned();
    if rows.is_empty() {
        text.push_str(tr(
            api.language,
            "Сквадов пока нет.",
            "No squads configured.",
        ));
    }
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|_| "database_unavailable")?;
        let name: Option<String> = row.try_get("name").map_err(|_| "database_unavailable")?;
        let label = escape(name.as_deref().unwrap_or("Squad"));
        let _ = writeln!(text, "• <b>{label}</b> · #{id}");
    }
    api.send(
        chat,
        &text,
        buttons(vec![vec![(
            tr(api.language, "🏠 Меню", "🏠 Menu"),
            "v:menu".into(),
        )]]),
    )
    .await
}

pub(super) async fn find_telegram(
    api: &BotApi,
    state: &AppState,
    chat: i64,
    raw: &str,
) -> Result<(), &'static str> {
    if raw.is_empty()
        || raw.len() > 19
        || !raw.bytes().all(|b| b.is_ascii_digit())
        || raw.parse::<i64>().is_ok_and(|id| id <= 0)
        || raw.parse::<i64>().is_err()
        || raw.starts_with('0')
    {
        return api.send(chat,tr(api.language,
            "Используйте <code>/findtg 123456789</code> — числовой Telegram ID пользователя.",
            "Use <code>/findtg 123456789</code> — a numeric Telegram user ID."),
            buttons(vec![vec![(tr(api.language,"🏠 Меню","🏠 Menu"),"v:menu".into())]])).await;
    }
    let rows = sqlx::query(
        "SELECT id,data->>'username' AS username FROM panel_records
         WHERE collection='users' AND BTRIM(data->>'tg')=$1
         ORDER BY id DESC LIMIT 20",
    )
    .bind(raw)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| "database_unavailable")?;
    let mut text = format!("🔎 <b>Telegram ID: {raw}</b>\n\n");
    if rows.is_empty() {
        text.push_str(tr(api.language, "Совпадений нет.", "No matches found."));
    }
    let mut keyboard = Vec::new();
    for row in rows {
        let id: i64 = row.try_get("id").map_err(|_| "database_unavailable")?;
        let username: String = row
            .try_get::<Option<String>, _>("username")
            .map_err(|_| "database_unavailable")?
            .unwrap_or_else(|| "User".into());
        let _ = writeln!(text, "• <b>{}</b> · #{id}", escape(&username));
        keyboard.push(vec![json!({"text":format!("👤 {}",username.chars().take(24).collect::<String>()),"callback_data":format!("v:user:{id}")})]);
    }
    keyboard.push(vec![
        json!({"text":tr(api.language,"🏠 Меню","🏠 Menu"),"callback_data":"v:menu"}),
    ]);
    api.send(chat, &text, json!(keyboard)).await
}

#[derive(Clone, Debug)]
struct Proposal {
    action: &'static str,
    user_id: i64,
    amount: i64,
    username: Option<String>,
}
fn parse_proposal(cmd: &str, arg: &str) -> Result<Proposal, &'static str> {
    let args: Vec<_> = arg.split_whitespace().collect();
    if args.len() != 2 {
        return Err("invalid_command");
    }
    let qty = args[1].parse::<i64>().map_err(|_| "invalid_command")?;
    match cmd {
        "/create" => {
            let username = args[0];
            if username.len() < 3
                || username.len() > 64
                || !username.is_ascii()
                || !username.bytes().enumerate().all(|(i, b)| {
                    b.is_ascii_alphanumeric() || (i > 0 && matches!(b, b'_' | b'-' | b'.'))
                })
                || !(1..=365).contains(&qty)
            {
                return Err("invalid_command");
            }
            Ok(Proposal {
                action: "create",
                user_id: 0,
                amount: qty,
                username: Some(username.to_owned()),
            })
        }
        "/renew" if (1..=3650).contains(&qty) => {
            let id = args[0].parse::<i64>().map_err(|_| "invalid_command")?;
            if id <= 0 {
                return Err("invalid_command");
            }
            Ok(Proposal {
                action: "renew",
                user_id: id,
                amount: qty,
                username: None,
            })
        }
        "/quota" if (0..=100000).contains(&qty) => {
            let id = args[0].parse::<i64>().map_err(|_| "invalid_command")?;
            if id <= 0 {
                return Err("invalid_command");
            }
            Ok(Proposal {
                action: "quota",
                user_id: id,
                amount: qty,
                username: None,
            })
        }
        _ => Err("invalid_command"),
    }
}

async fn propose(
    api: &BotApi,
    state: &AppState,
    chat: i64,
    admin_id: i64,
    proposal: Proposal,
) -> Result<(), &'static str> {
    // Fail early if the target does not exist. Revalidate under lock at commit.
    if proposal.user_id > 0 {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users' AND id=$1)",
        )
        .bind(proposal.user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| "database_unavailable")?;
        if !exists {
            return api
                .send(
                    chat,
                    tr(api.language, "Пользователь не найден.", "User not found."),
                    buttons(vec![vec![(
                        tr(api.language, "🏠 Меню", "🏠 Menu"),
                        "v:menu".into(),
                    )]]),
                )
                .await;
        }
    }
    let nonce = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO telegram_admin_bot_actions(nonce,admin_id,user_id,action,amount,username,expires_at)
         VALUES($1::UUID,$2,$3,$4,$5,$6,NOW()+INTERVAL '60 seconds')"
    ).bind(nonce.to_string()).bind(admin_id).bind(proposal.user_id)
    .bind(proposal.action).bind(proposal.amount).bind(&proposal.username)
    .execute(&state.pool).await.map_err(|_|"database_unavailable")?;
    let description = match proposal.action {
        "renew" => format!(
            "{} #{} · {} {}",
            tr(api.language, "Продлить", "Extend"),
            proposal.user_id,
            proposal.amount,
            tr(api.language, "дней", "days")
        ),
        "quota" => format!(
            "{} #{} · {} GB (0 = unlimited)",
            tr(api.language, "Лимит трафика", "Traffic quota"),
            proposal.user_id,
            proposal.amount
        ),
        "create" => format!(
            "{} {} · {} {}",
            tr(api.language, "Создать пользователя", "Create user"),
            escape(proposal.username.as_deref().unwrap_or("")),
            proposal.amount,
            tr(api.language, "дней", "days")
        ),
        _ => return Err("invalid_command"),
    };
    let text = format!(
        "⚠️ <b>{}</b>\n\n{}\n\n{}",
        tr(api.language, "Подтвердите операцию", "Confirm operation"),
        description,
        tr(
            api.language,
            "Подтверждение доступно 60 секунд и используется один раз.",
            "Confirmation is available for 60 seconds and can be used only once."
        )
    );
    api.send(
        chat,
        &text,
        buttons(vec![
            vec![(
                tr(api.language, "✅ Подтвердить", "✅ Confirm"),
                format!("x:{nonce}"),
            )],
            vec![(tr(api.language, "Отмена", "Cancel"), "v:menu".into())],
        ]),
    )
    .await
}

pub(super) async fn extra_command(
    api: &BotApi,
    state: &AppState,
    chat: i64,
    admin_id: i64,
    cmd: &str,
    arg: &str,
) -> Option<Result<(), &'static str>> {
    match cmd {
        "/language" | "/lang" => Some(choose_language(api, chat).await),
        "/squads" => Some(squads(api, state, chat).await),
        "/findtg" => Some(find_telegram(api, state, chat, arg).await),
        "/create" | "/renew" | "/quota" => {
            let result=match parse_proposal(cmd,arg) {
                Ok(proposal)=>propose(api,state,chat,admin_id,proposal).await,
                Err(_)=>api.send(chat,tr(api.language,
                    "Формат: /create username 30 | /renew 123 30 | /quota 123 50 (0 = безлимит)",
                    "Usage: /create username 30 | /renew 123 30 | /quota 123 50 (0 = unlimited)"),
                    buttons(vec![vec![(tr(api.language,"🏠 Меню","🏠 Menu"),"v:menu".into())]])).await,
            };
            Some(result)
        }
        _ => None,
    }
}

pub(super) async fn apply_extra(
    state: &AppState,
    admin_id: i64,
    nonce: Uuid,
    row: &sqlx::postgres::PgRow,
    tx: &mut Transaction<'_, Postgres>,
    language: Language,
) -> Result<(i64, String), &'static str> {
    let action: String = row.try_get("action").map_err(|_| "database_unavailable")?;
    let id: i64 = row.try_get("user_id").map_err(|_| "database_unavailable")?;
    let amount: i64 = row.try_get("amount").map_err(|_| "database_unavailable")?;
    let username: Option<String> = row
        .try_get("username")
        .map_err(|_| "database_unavailable")?;
    let result_id;
    let summary;
    if action == "create" {
        let username = username.as_deref().ok_or("invalid_command")?;
        if parse_proposal("/create", &format!("{username} {amount}")).is_err() {
            return Err("invalid_command");
        }
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(username.to_lowercase())
            .execute(&mut **tx)
            .await
            .map_err(|_| "database_unavailable")?;
        let duplicate: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM panel_records WHERE collection='users'
             AND LOWER(data->>'username')=LOWER($1))",
        )
        .bind(username)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| "database_unavailable")?;
        if duplicate {
            return Err("duplicate_username");
        }
        let now = crate::telegram_admin_bot::now_ms();
        let expire = now
            .checked_add(amount.checked_mul(86_400_000).ok_or("invalid_command")?)
            .ok_or("invalid_command")?;
        let mut record = Map::new();
        record.insert("username".into(), json!(username));
        record.insert("hold".into(), json!(false));
        record.insert("expireAt".into(), json!(expire));
        record.insert("limit".into(), json!(0));
        record.insert("used".into(), json!(0));
        crate::protocol_credentials::provision(&mut record);
        let data = Value::Object(record);
        crate::validate_record("users", &data).map_err(|_| "invalid_command")?;
        result_id = sqlx::query_scalar(
            "INSERT INTO panel_records(collection,data) VALUES('users',$1) RETURNING id",
        )
        .bind(data)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| "database_unavailable")?;
        crate::user_subscriptions::provision_new_user(state, result_id, tx)
            .await
            .map_err(|_| "database_unavailable")?;
        summary = format!(
            "{} #{result_id} {}",
            tr(language, "Пользователь", "User"),
            tr(language, "создан.", "created.")
        );
    } else {
        if !matches!(action.as_str(), "renew" | "quota") || id <= 0 {
            return Err("invalid_command");
        }
        let db = sqlx::query(
            "SELECT data FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE",
        )
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| "database_unavailable")?;
        let Some(db) = db else {
            return Err("user_not_found");
        };
        let mut data: Value = db.try_get("data").map_err(|_| "database_unavailable")?;
        if action == "renew" {
            if !(1..=3650).contains(&amount) || data.get("hold") == Some(&Value::Bool(true)) {
                return Err("invalid_command");
            }
            // Do not implicitly turn a lifetime account into an expiring account.
            let old = data
                .get("expireAt")
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .ok_or("nonexpiring_user")?;
            let new = old
                .max(crate::telegram_admin_bot::now_ms())
                .checked_add(amount.checked_mul(86_400_000).ok_or("invalid_command")?)
                .ok_or("invalid_command")?;
            data["expireAt"] = json!(new);
            summary = format!(
                "{} #{id} {} {amount} {}",
                tr(language, "Пользователь", "User"),
                tr(language, "продлён на", "renewed by"),
                tr(language, "дней.", "days.")
            );
        } else {
            if !(0..=100000).contains(&amount) {
                return Err("invalid_command");
            }
            data["limit"] = json!(amount);
            summary = format!(
                "{} #{id}: {} {amount} GB.",
                tr(language, "Пользователь", "User"),
                tr(language, "лимит установлен", "quota set to")
            );
        }
        crate::validate_record("users", &data).map_err(|_| "invalid_command")?;
        sqlx::query(
            "UPDATE panel_records SET data=$2,updated_at=NOW()
             WHERE collection='users' AND id=$1",
        )
        .bind(id)
        .bind(data)
        .execute(&mut **tx)
        .await
        .map_err(|_| "database_unavailable")?;
        result_id = id;
    }
    sqlx::query(
        "UPDATE telegram_admin_bot_actions SET consumed_at=NOW()
         WHERE nonce=$1::UUID AND consumed_at IS NULL",
    )
    .bind(nonce.to_string())
    .execute(&mut **tx)
    .await
    .map_err(|_| "database_unavailable")?;
    sqlx::query(
        "INSERT INTO panel_audit_log(actor,action,collection,record_id,detail)
         VALUES($1,$2,'users',$3,$4)",
    )
    .bind(format!("telegram:{admin_id}"))
    .bind(format!("telegram_bot.user_{action}"))
    .bind(result_id)
    .bind(json!({"telegramAdminId":admin_id,"amount":amount,"operationId":nonce.to_string()}))
    .execute(&mut **tx)
    .await
    .map_err(|_| "database_unavailable")?;
    Ok((result_id, summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn operations_accept_only_bounded_confirmed_inputs() {
        assert!(parse_proposal("/create", "Test_User 30").is_ok());
        assert!(parse_proposal("/create", "bad name 30").is_err());
        assert!(parse_proposal("/create", "user 99999").is_err());
        assert!(parse_proposal("/renew", "1 30").is_ok());
        assert!(parse_proposal("/renew", "0 30").is_err());
        assert!(parse_proposal("/quota", "1 0").is_ok());
        assert!(parse_proposal("/quota", "1 100001").is_err());
        assert!(parse_proposal("/delete", "1 1").is_err());
    }
}
