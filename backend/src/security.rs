//! Account security policy persisted in PostgreSQL.
//! This is an owner-managed configuration, not browser-only UI state.
//! Dashboard path is the sole HTML entrypoint; authentication is still mandatory.
use crate::{admin_accounts, auth::{self, AuthUser}, ApiError, AppState};
use axum::{
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SecurityPolicy {
    pub session_hours: i64,
    pub idle_minutes: i64,
    pub max_sessions: i64,
    pub login_attempts: i64,
    pub lockout_minutes: i64,
    pub dashboard_path: String,
}
impl Default for SecurityPolicy {
    fn default() -> Self {
        Self { session_hours:1, idle_minutes:15, max_sessions:1,
            login_attempts:3, lockout_minutes:15, dashboard_path:std::env::var("DASHBOARD_PATH").unwrap_or_else(|_| "/dashboard/nexus".into()) }
    }
}
impl SecurityPolicy {
    pub fn validate(&self) -> Result<(), ApiError> {
        for (value,min,max,name) in [
            (self.session_hours,1,168,"Срок действия сессии"),
            (self.idle_minutes,0,1440,"Таймаут бездействия"),
            (self.max_sessions,1,20,"Количество одновременных сессий"),
            (self.login_attempts,3,15,"Порог блокировки входа"),
            (self.lockout_minutes,5,120,"Время блокировки"),
        ] {
            if !(min..=max).contains(&value) {
                return Err(ApiError::new(StatusCode::BAD_REQUEST,
                    format!("{name}: допустимо от {min} до {max}.")));
            }
        }
        let Some(slug)=self.dashboard_path.strip_prefix("/dashboard/") else {
            return Err(ApiError::new(StatusCode::BAD_REQUEST,
                "Путь должен иметь вид /dashboard/ваше-имя."));
        };
        if !(4..=64).contains(&slug.len())
            || !slug.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_') {
            return Err(ApiError::new(StatusCode::BAD_REQUEST,
                "После /dashboard/ используйте 4–64 символа: латиницу, цифры, дефис или _.")); 
        }
        Ok(())
    }
}

pub async fn get_policy(pool:&PgPool) -> Result<SecurityPolicy,ApiError> {
    let v:Option<Value>=sqlx::query_scalar(
        "SELECT value FROM app_settings WHERE key='security'"
    ).fetch_optional(pool).await?;
    let policy=match v {
        Some(value)=>serde_json::from_value::<SecurityPolicy>(value).map_err(|error|{
            tracing::error!(%error,"Invalid persisted security policy");
            ApiError::new(StatusCode::SERVICE_UNAVAILABLE,"Настройки безопасности повреждены. Обратитесь к администратору.")
        })?,
        None=>SecurityPolicy::default(),
    };
    policy.validate().map_err(|_|ApiError::new(StatusCode::SERVICE_UNAVAILABLE,
        "Настройки безопасности содержат недопустимые значения."))?;
    Ok(policy)
}

pub async fn get_settings(State(state):State<AppState>,Extension(actor):Extension<AuthUser>)
    -> Result<Json<Value>,ApiError> {
    // The dashboard URL and authentication policy are private administrative
    // settings, not data a monitoring-only observer needs.
    crate::require_mutation(&actor)?;
    let policy=get_policy(&state.pool).await?;
    Ok(Json(json!({"policy":policy,"canEdit":actor.role=="owner"})))
}

pub async fn update_settings(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,
    Json(policy):Json<SecurityPolicy>) -> Result<Json<Value>,ApiError> {
    admin_accounts::require_owner(&actor)?;
    policy.validate()?;
    let data=serde_json::to_value(&policy)
        .map_err(|_|ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Не удалось сохранить настройки."))?;
    sqlx::query("INSERT INTO app_settings(key,value) VALUES ('security',$1) \
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()")
        .bind(data).execute(&state.pool).await?;
    // The container cannot open host .env. It only writes a dedicated, limited-scope mirror.
    if let Ok(path)=std::env::var("DASHBOARD_PATH_MIRROR") {
        tokio::fs::write(path,format!("{}\n",policy.dashboard_path)).await.map_err(|error| {
            tracing::error!(%error,"Dashboard path mirror sync failed");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Настройка сохранена в базе, но синхронизация .env не удалась.")
        })?;
    }
    crate::audit(&state.pool,&actor.username,"security.policy.updated",None,None,json!({
        "sessionHours":policy.session_hours,"idleMinutes":policy.idle_minutes,
        "maxSessions":policy.max_sessions,"loginAttempts":policy.login_attempts,
        "lockoutMinutes":policy.lockout_minutes,"dashboardPath":policy.dashboard_path
    })).await;
    Ok(Json(json!({"policy":policy,"canEdit":true})))
}

/// Owner-only metadata from the existing server-side audit log.
/// Detail JSON is intentionally not exposed: older entries may contain secrets.
pub async fn audit_events(State(state):State<AppState>,Extension(actor):Extension<AuthUser>)
    -> Result<Json<Value>,ApiError> {
    admin_accounts::require_owner(&actor)?;
    let rows=sqlx::query(
        "SELECT id,actor,action,collection,record_id, \
           (extract(epoch from created_at)*1000)::bigint AS created_at_ms \
         FROM panel_audit_log ORDER BY created_at DESC,id DESC LIMIT 100"
    ).fetch_all(&state.pool).await?;
    let events=rows.iter().map(|row|->Result<Value,ApiError>{
        let created_ms:i64=row.try_get("created_at_ms")?;
        Ok(json!({
            "id":row.try_get::<i64,_>("id")?,
            "actor":row.try_get::<String,_>("actor")?,
            "action":row.try_get::<String,_>("action")?,
            "collection":row.try_get::<Option<String>,_>("collection")?,
            "recordId":row.try_get::<Option<i64>,_>("record_id")?,
            "createdAtMs":created_ms,
        }))
    }).collect::<Result<Vec<_>,_>>()?;
    Ok(Json(json!({"events":events,"limit":100})))
}

pub async fn sessions(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,
    headers:HeaderMap)->Result<Json<Value>,ApiError>{
    let active=auth::session_token_hash(&headers);
    let rows=sqlx::query("SELECT id,token_hash, \
        (EXTRACT(EPOCH FROM created_at)*1000)::BIGINT AS created_ms, \
        (EXTRACT(EPOCH FROM expires_at)*1000)::BIGINT AS expires_ms, \
        (EXTRACT(EPOCH FROM COALESCE(last_seen_at,created_at))*1000)::BIGINT AS seen_ms \
        FROM panel_sessions WHERE admin_id=$1 AND expires_at>NOW() ORDER BY created_at DESC LIMIT 100")
        .bind(actor.id).fetch_all(&state.pool).await?;
    let sessions=rows.iter().map(|row|->Result<Value,ApiError>{
        let hash:String=row.try_get("token_hash")?;
        Ok(json!({"id":row.try_get::<i64,_>("id")?,
            "current":active.as_deref()==Some(hash.as_str()),
            "createdAt":row.try_get::<i64,_>("created_ms")?,
            "expiresAt":row.try_get::<i64,_>("expires_ms")?,
            "lastActivity":row.try_get::<i64,_>("seen_ms")?}))
    }).collect::<Result<Vec<_>,_>>()?;
    Ok(Json(json!({"sessions":sessions})))
}

pub async fn revoke_session(State(state):State<AppState>,Extension(actor):Extension<AuthUser>,
    Path(id):Path<i64>,headers:HeaderMap)->Result<Json<Value>,ApiError>{
    let token=auth::session_token_hash(&headers);
    let deleted=sqlx::query("DELETE FROM panel_sessions WHERE id=$1 AND admin_id=$2 RETURNING token_hash")
        .bind(id).bind(actor.id).fetch_optional(&state.pool).await?;
    let Some(row)=deleted else{
        return Err(ApiError::new(StatusCode::NOT_FOUND,"Сессия не найдена."));
    };
    let removed:String=row.try_get("token_hash")?;
    crate::audit(&state.pool,&actor.username,"security.session.revoked",None,None,
        json!({"self":token.as_deref()==Some(removed.as_str())})).await;
    Ok(Json(json!({"revoked":true,"current":token.as_deref()==Some(removed.as_str())})))
}

pub async fn revoke_other_sessions(State(state):State<AppState>,
    Extension(actor):Extension<AuthUser>,headers:HeaderMap)->Result<Json<Value>,ApiError>{
    let Some(token)=auth::session_token_hash(&headers) else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED,"Сессия не найдена."));
    };
    let result=sqlx::query(
        "DELETE FROM panel_sessions WHERE admin_id=$1 AND token_hash<>$2")
        .bind(actor.id).bind(token).execute(&state.pool).await?;
    crate::audit(&state.pool,&actor.username,"security.sessions.revoked_others",None,None,
        json!({"count":result.rows_affected()})).await;
    Ok(Json(json!({"revokedCount":result.rows_affected()})))
}

pub async fn dashboard_entry(State(state):State<AppState>,Path(slug):Path<String>,
    headers:HeaderMap)->Response {
    let policy=match get_policy(&state.pool).await{
        Ok(p)=>p,Err(_)=>return (StatusCode::SERVICE_UNAVAILABLE,"Security policy unavailable").into_response()
    };
    if format!("/dashboard/{slug}")!=policy.dashboard_path {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !crate::auth::is_authenticated(&state,&headers).await {
        let static_dir=std::env::var("STATIC_DIR").unwrap_or_else(|_|"/app/static".to_string());
        return match tokio::fs::read_to_string(std::path::PathBuf::from(static_dir).join("login.html")).await {
            Ok(html)=>axum::response::Html(html).into_response(),
            Err(error)=>{tracing::error!(%error,"Could not read login HTML");StatusCode::INTERNAL_SERVER_ERROR.into_response()}
        };
    }
    let static_dir=std::env::var("STATIC_DIR").unwrap_or_else(|_|"/app/static".to_string());
    let content=match tokio::fs::read_to_string(std::path::PathBuf::from(static_dir).join("index.html")).await {
        Ok(body)=>body,
        Err(error)=>{
            tracing::error!(%error,"Could not read dashboard entry HTML");
            return (StatusCode::INTERNAL_SERVER_ERROR,"Panel assets unavailable").into_response();
        }
    };
    // The dashboard alias is a nested URL. Asset URLs in the regular /
    // entry page are relative; rebase only the HTML copy served at the alias.
    // The canonical root HTML and links remain untouched.
    let mut html=content;
    for asset in [
        "styles.css","global-hover.css","subscription-studio.css","xray-studio-v4.css","node-geodata.css","node-routing.css",
        "xray-json-intelligence.js","xray-json-diagnostics.js","i18n.js",
        "subscription-studio.js","qr-code.js","mfa-ui.js","security-ui.js",
        "app.js","node-geodata.js","node-routing.js","xray-studio-v4.js","xray-studio-dialog.js"
    ] {
        html=html.replace(&format!("href=\"{asset}"),&format!("href=\"/{asset}"));
        html=html.replace(&format!("src=\"{asset}"),&format!("src=\"/{asset}"));
    }
    axum::response::Html(html).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_ranges_and_dashboard_slug() {
        let mut p=SecurityPolicy::default();assert!(p.validate().is_ok());
        p.session_hours=168;p.idle_minutes=1440;p.max_sessions=20;
        p.login_attempts=15;p.lockout_minutes=120;
        p.dashboard_path="/dashboard/private-admin_2026".into();assert!(p.validate().is_ok());
        p.session_hours=0;assert!(p.validate().is_err());p.session_hours=12;
        p.dashboard_path="/login".into();assert!(p.validate().is_err());
        p.dashboard_path="/dashboard/../../../".into();assert!(p.validate().is_err());
    }
}
