//! Real panel login accounts. The legacy panel_records('admins') collection
//! is not an authentication store and must not be used for access control.
use crate::{auth::AuthUser, ApiError, AppState};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

pub(crate) fn require_owner(actor: &AuthUser) -> Result<(), ApiError> {
    if actor.role == "owner" { Ok(()) }
    else { Err(ApiError::new(StatusCode::FORBIDDEN, "Только владелец может управлять администраторами.")) }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateAccount {
    username: String,
    password: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateAccount {
    username: Option<String>,
    password: Option<String>,
    role: Option<String>,
    is_active: Option<bool>,
}

fn validate_username(value: &str) -> Result<(), ApiError> {
    if value.len() < 3 || value.len() > 64 ||
        !value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Логин: 3–64 символа (латиница, цифры, _, ., -)."));
    }
    Ok(())
}

fn validate_role(value: &str) -> Result<(), ApiError> {
    if !matches!(value, "owner" | "admin" | "viewer") {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Неизвестная роль администратора."));
    }
    Ok(())
}

fn password_hash(password: &str) -> Result<String, ApiError> {
    if password.len() < 16 || password.len() > 1024 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Пароль должен содержать от 16 до 1024 символов."));
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Не удалось защитить пароль."))
}

pub(crate) async fn accounts(pool: &PgPool) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, username, role, is_active, created_at, last_login_at \
         FROM panel_auth_users ORDER BY id",
    )
    .fetch_all(pool).await?;
    rows.iter().map(|row| Ok(json!({
        "id": row.try_get::<i64, _>("id")?,
        "username": row.try_get::<String, _>("username")?,
        "role": row.try_get::<String, _>("role")?,
        "disabled": !row.try_get::<bool, _>("is_active")?,
        "last": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_login_at")?.map(|t| t.timestamp_millis()),
        "created": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")?.timestamp_millis()
    }))).collect()
}

pub(crate) async fn list(
    State(state): State<AppState>, Extension(actor): Extension<AuthUser>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    Ok(Json(json!({"items":accounts(&state.pool).await?})))
}

pub(crate) async fn create(
    State(state): State<AppState>, Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateAccount>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    require_owner(&actor)?;
    validate_username(&body.username)?;
    validate_role(&body.role)?;
    let hashed = password_hash(&body.password)?;
    let row = sqlx::query(
        "INSERT INTO panel_auth_users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(&body.username).bind(&hashed).bind(&body.role)
    .fetch_one(&state.pool).await?;
    let id: i64 = row.try_get("id")?;
    super::audit(&state.pool, &actor.username, "admin.created", Some("admins"), Some(id),
        json!({"role":body.role})).await;
    let record=accounts(&state.pool).await?.into_iter()
        .find(|r| r.get("id").and_then(Value::as_i64)==Some(id))
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Запись администратора не найдена."))?;
    Ok((StatusCode::CREATED,Json(record)))
}

pub(crate) async fn update(
    State(state): State<AppState>, Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>, Json(patch): Json<UpdateAccount>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    if id<=0 { return Err(ApiError::new(StatusCode::BAD_REQUEST,"Некорректный ID администратора.")); }
    if let Some(username)=&patch.username { validate_username(username)?; }
    if let Some(role)=&patch.role { validate_role(role)?; }
    let hashed=patch.password.as_deref().map(password_hash).transpose()?;
    let mut tx=state.pool.begin().await?;
    // Serialize ownership changes to avoid concurrent removal of the last owner.
    sqlx::query("SELECT id FROM panel_auth_users WHERE role='owner' FOR UPDATE")
        .fetch_all(&mut *tx).await?;
    let row=sqlx::query("SELECT role, is_active FROM panel_auth_users WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Администратор не найден."))?;
    let current_role:String=row.try_get("role")?;
    let active:bool=row.try_get("is_active")?;
    let role=patch.role.as_deref().unwrap_or(&current_role);
    let new_active=patch.is_active.unwrap_or(active);
    if actor.id==id && (role!="owner" || !new_active) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST,"Нельзя понизить роль или отключить собственную учётную запись."));
    }
    if current_role=="owner" && (role!="owner" || !new_active) {
        let remaining:i64=sqlx::query_scalar("SELECT COUNT(*) FROM panel_auth_users WHERE role='owner' AND is_active=TRUE AND id<>$1")
            .bind(id).fetch_one(&mut *tx).await?;
        if remaining==0 {
            return Err(ApiError::new(StatusCode::CONFLICT,"Нельзя отключить последнего активного владельца."));
        }
    }
    sqlx::query(
        "UPDATE panel_auth_users SET username=COALESCE($2,username), \
         password_hash=COALESCE($3,password_hash),role=$4,is_active=$5 WHERE id=$1",
    )
    .bind(id).bind(&patch.username).bind(&hashed).bind(role).bind(new_active)
    .execute(&mut *tx).await?;
    // Permissions or credentials change invalidates existing sessions immediately.
    if hashed.is_some() || role != current_role || !new_active {
        sqlx::query("DELETE FROM panel_sessions WHERE admin_id=$1").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    super::audit(&state.pool, &actor.username, "admin.updated",Some("admins"),Some(id),
        json!({"role":role,"active":new_active,"passwordChanged":hashed.is_some()})).await;
    let record=accounts(&state.pool).await?.into_iter()
        .find(|r|r.get("id").and_then(Value::as_i64)==Some(id))
        .ok_or_else(||ApiError::new(StatusCode::INTERNAL_SERVER_ERROR,"Запись администратора не найдена."))?;
    Ok(Json(record))
}

pub(crate) async fn delete(
    State(state): State<AppState>, Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    require_owner(&actor)?;
    if id==actor.id { return Err(ApiError::new(StatusCode::BAD_REQUEST,"Нельзя удалить собственную учётную запись.")); }
    let mut tx=state.pool.begin().await?;
    sqlx::query("SELECT id FROM panel_auth_users WHERE role='owner' FOR UPDATE")
        .fetch_all(&mut *tx).await?;
    let row=sqlx::query("SELECT role FROM panel_auth_users WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(||ApiError::new(StatusCode::NOT_FOUND,"Администратор не найден."))?;
    let role:String=row.try_get("role")?;
    if role=="owner" {
        let remaining:i64=sqlx::query_scalar("SELECT COUNT(*) FROM panel_auth_users WHERE role='owner' AND is_active=TRUE AND id<>$1")
            .bind(id).fetch_one(&mut *tx).await?;
        if remaining==0 { return Err(ApiError::new(StatusCode::CONFLICT,"Нельзя удалить последнего активного владельца.")); }
    }
    sqlx::query("DELETE FROM panel_auth_users WHERE id=$1").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    super::audit(&state.pool,&actor.username,"admin.deleted",Some("admins"),Some(id),
        json!({"role":role})).await;
    Ok(Json(json!({"id":id})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_accounts_rejected() {
        assert!(validate_username("valid.admin_1").is_ok());
        assert!(validate_username("a").is_err());
        assert!(validate_username("a@b").is_err());
        assert!(validate_role("viewer").is_ok());
        assert!(validate_role("developer").is_err());
        assert!(password_hash("short").is_err());
        assert!(password_hash("correct horse battery staple").is_ok());
    }
    #[test]
    fn permissions_are_server_side() {
        let owner=AuthUser{id:1,username:"owner".into(),role:"owner".into()};
        let admin=AuthUser{id:2,username:"admin".into(),role:"admin".into()};
        let viewer=AuthUser{id:3,username:"viewer".into(),role:"viewer".into()};
        assert!(require_owner(&owner).is_ok());
        assert!(require_owner(&admin).is_err());
        assert!(require_owner(&viewer).is_err());
    }
}
