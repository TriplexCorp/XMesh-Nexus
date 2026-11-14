//! Idempotent per-user membership edits; never modify squad configuration,
//! node enrollment or other users outside a token's allowedUserIds.
use super::{Problem, ServicePrincipal, grants, reply};
use crate::AppState;
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde_json::{Value, json};
use sqlx::{Postgres, Row, Transaction};

const fn invalid() -> Problem {
    Problem::new(
        StatusCode::BAD_REQUEST,
        "validation_error",
        "Invalid squad member IDs",
    )
}

fn parse_members(body: &Value) -> Result<Vec<i64>, Problem> {
    let object = body.as_object().ok_or_else(invalid)?;
    if object.len() != 1 {
        return Err(invalid());
    }
    let ids = object
        .get("userIds")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if ids.is_empty() || ids.len() > 100 {
        return Err(invalid());
    }
    let mut parsed = ids
        .iter()
        .map(|id| id.as_i64().filter(|v| *v > 0).ok_or_else(invalid))
        .collect::<Result<Vec<_>, _>>()?;
    parsed.sort_unstable();
    parsed.dedup();
    if parsed.len() != ids.len() {
        return Err(invalid());
    }
    Ok(parsed)
}

async fn change_locked(
    tx: &mut Transaction<'_, Postgres>,
    squad_id: i64,
    ids: &[i64],
    add: bool,
) -> Result<Vec<i64>, Problem> {
    // Hold a shared lock until commit so a concurrent administrator cannot
    // delete the squad between validation and the membership updates.
    let exists: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM panel_records
         WHERE collection='squads' AND id=$1 FOR SHARE",
    )
    .bind(squad_id)
    .fetch_optional(&mut **tx)
    .await?;
    if exists.is_none() {
        return Err(Problem::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "Squad not found",
        ));
    }
    // Deterministic lock order prevents deadlocks across concurrent batch operations.
    let rows = sqlx::query(
        "SELECT id,data FROM panel_records WHERE collection='users'
         AND id=ANY($1::BIGINT[]) ORDER BY id FOR UPDATE",
    )
    .bind(ids)
    .fetch_all(&mut **tx)
    .await?;
    if rows.len() != ids.len() {
        return Err(Problem::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "User not found",
        ));
    }
    let mut changed = Vec::new();
    for row in rows {
        let user_id: i64 = row.try_get("id")?;
        let mut user: Value = row.try_get("data")?;
        // If an existing record is malformed, fail closed rather than
        // overwriting any opaque membership or silently clearing associations.
        let squads = user.get("squads").map_or(Ok(Vec::new()), |value| {
            value
                .as_array()
                .filter(|arr| {
                    arr.len() <= 256 && arr.iter().all(|v| v.as_i64().is_some_and(|id| id > 0))
                })
                .cloned()
                .ok_or_else(Problem::unavailable)
        })?;
        let mut memberships = squads;
        let present = memberships.iter().any(|v| v.as_i64() == Some(squad_id));
        if present == add {
            continue;
        }
        if add {
            if memberships.len() >= 256 {
                return Err(Problem::new(
                    StatusCode::CONFLICT,
                    "member_limit",
                    "Squad membership limit reached",
                ));
            }
            memberships.push(json!(squad_id));
        } else {
            memberships.retain(|v| v.as_i64() != Some(squad_id));
        }
        user["squads"] = json!(memberships);
        // Persist only the association, leaving credentials and usage unchanged.
        sqlx::query(
            "UPDATE panel_records SET data=$2,updated_at=NOW()
             WHERE collection='users' AND id=$1",
        )
        .bind(user_id)
        .bind(&user)
        .execute(&mut **tx)
        .await?;
        changed.push(user_id);
    }
    Ok(changed)
}

async fn complete(
    tx: &mut Transaction<'_, Postgres>,
    principal: &ServicePrincipal,
    key: &str,
    action: &str,
    id: i64,
    result: &Value,
) -> Result<(), Problem> {
    sqlx::query(
        "UPDATE integration_operations SET response=$3,completed_at=NOW()
         WHERE client_id=$1 AND idempotency_key=$2::UUID",
    )
    .bind(principal.client_id)
    .bind(key)
    .bind(result)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO panel_audit_log (actor,action,collection,record_id,detail)
         VALUES($1,$2,'squads',$3,$4)",
    )
    .bind(format!(
        "integration:{}:{}",
        principal.client_id, principal.name
    ))
    .bind(action)
    .bind(id)
    .bind(json!({
        "clientId":principal.client_id,
        "tokenId":principal.token_id,
        "idempotencyKey":key,
        "changedCount":result.get("changedUserIds").and_then(Value::as_array).map_or(0,Vec::len)
    }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn mutate(
    state: AppState,
    principal: ServicePrincipal,
    id: i64,
    headers: HeaderMap,
    body: Value,
    add: bool,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope("squads:members:write")?;
    if id <= 0 {
        return Err(Problem::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "Squad not found",
        ));
    }
    let user_ids = parse_members(&body)?;
    for uid in &user_ids {
        principal.allow_user(*uid)?;
    }
    let action = if add {
        "squad.members.add"
    } else {
        "squad.members.remove"
    };
    let key = grants::key(&headers)?;
    let hash = grants::request_hash(action, id, &body)?;
    let mut tx = state.pool.begin().await?;
    if let Some(previous) = grants::claim(&mut tx, &principal, &key, action, &hash).await? {
        tx.commit().await?;
        let mut output = reply(previous);
        output.0["meta"]["replayed"] = json!(true);
        return Ok(output);
    }
    let changed = change_locked(&mut tx, id, &user_ids, add).await?;
    let result = json!({
        "squadId":id,
        "requestedUserIds":user_ids,
        "changedUserIds":changed,
        "operationId":key,
        "requiresNodeSync":!changed.is_empty()
    });
    complete(&mut tx, &principal, &key, action, id, &result).await?;
    tx.commit().await?;
    Ok(reply(result))
}

pub(super) async fn add(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Problem> {
    mutate(state, principal, id, headers, body, true).await
}

pub(super) async fn remove(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Problem> {
    mutate(state, principal, id, headers, body, false).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_duplicate_invalid_and_unbounded_batch() {
        for body in [
            json!({"userIds":[]}),
            json!({"userIds":[-1]}),
            json!({"userIds":[2,2]}),
            json!({"userIds":["2"]}),
            json!({"userIds":[1],"permissions":["owner"]}),
            json!({"userIds":null}),
            json!({"userIds":[1.5]}),
            json!({"userIds":(1..=101).collect::<Vec<_>>()}),
        ] {
            assert!(parse_members(&body).is_err(), "{body}");
        }
        assert_eq!(
            parse_members(&json!({"userIds":[42,5]})).unwrap(),
            vec![5, 42]
        );
    }
}
