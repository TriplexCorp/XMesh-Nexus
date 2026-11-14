//! Explicit quota policy API. Usage is always server-metered; API clients
//! may change limits but never reset or forge the signed traffic ledgers.
use super::{Problem, ServicePrincipal, grants, reply, user_mutations};
use crate::{AppState, cdn_quota, node_user_quotas};
use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use sqlx::{Postgres, Row, Transaction};

const fn bad() -> Problem {
    Problem::new(
        StatusCode::BAD_REQUEST,
        "validation_error",
        "Invalid quota policy",
    )
}

fn amount(value: &Value) -> Result<f64, Problem> {
    value
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=1_000_000.0).contains(v))
        .ok_or_else(bad)
}

fn parse_policy(body: &Value) -> Result<Map<String, Value>, Problem> {
    let fields = body.as_object().ok_or_else(bad)?;
    if fields.is_empty()
        || fields
            .keys()
            .any(|field| !matches!(field.as_str(), "limitGb" | "cdnLimitGb" | "nodeRules"))
    {
        return Err(bad());
    }
    let mut patch = Map::new();
    for (external, internal) in [("limitGb", "limit"), ("cdnLimitGb", "cdnLimitGb")] {
        if let Some(value) = fields.get(external) {
            patch.insert(internal.into(), json!(amount(value)?));
        }
    }
    if let Some(value) = fields.get("nodeRules") {
        let entries = value
            .as_array()
            .filter(|v| v.len() <= 256)
            .ok_or_else(bad)?;
        let mut policies = Map::new();
        for entry in entries {
            let rule = entry.as_object().ok_or_else(bad)?;
            if rule.len() != 3
                || !rule.contains_key("nodeId")
                || !rule.contains_key("period")
                || !rule.contains_key("limitGb")
            {
                return Err(bad());
            }
            let node_id = rule
                .get("nodeId")
                .and_then(Value::as_i64)
                .filter(|id| *id > 0)
                .ok_or_else(bad)?;
            let period = match rule.get("period").and_then(Value::as_str) {
                Some("day") => "daily",
                Some("week") => "weekly",
                Some("month") => "monthly",
                Some("lifetime") => "lifetime",
                _ => return Err(bad()),
            };
            let gb = amount(rule.get("limitGb").ok_or_else(bad)?)?;
            if gb <= 0.0 || crate::gb_to_bytes_i64(gb) <= 0 {
                return Err(bad());
            }
            if policies
                .insert(node_id.to_string(), json!({"limitGb":gb,"period":period}))
                .is_some()
            {
                return Err(bad());
            }
        }
        patch.insert("nodeTrafficLimits".into(), Value::Object(policies));
    }
    Ok(patch)
}

fn bucket(scope: &str, limit_bytes: Option<i64>, used_bytes: i64, period: &str) -> Value {
    json!({
        "scope": scope,
        "limitBytes": limit_bytes,
        "usedBytes": used_bytes.max(0),
        "remainingBytes": limit_bytes.map(|limit| limit.saturating_sub(used_bytes.max(0)).max(0)),
        "period": period,
        "resetAt": null
    })
}

async fn view(state: &AppState, id: i64) -> Result<(Value, i64), Problem> {
    let row = sqlx::query(
        "SELECT data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records WHERE collection='users' AND id=$1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    let user: Value = row.try_get("data")?;
    let revision: i64 = row.try_get("revision")?;
    let base_used_bytes = crate::gb_to_bytes_i64(
        user.get("used")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .max(0.0),
    );
    let signed_used_bytes = crate::user_metered_bytes(&state.pool, id)
        .await
        .map_err(Problem::from)?;
    let used_bytes = base_used_bytes.saturating_add(signed_used_bytes.max(0));
    let main_limit = user.get("limit").and_then(Value::as_f64).unwrap_or(0.0);
    let main_bytes = if main_limit > 0.0 {
        Some(crate::gb_to_bytes_i64(main_limit))
    } else {
        None
    };
    let settings = crate::read_settings(&state.pool)
        .await
        .map_err(Problem::from)?;
    let cdn_used = cdn_quota::usage_for_user(&state.pool, &settings, id)
        .await
        .map_err(Problem::from)?;
    let cdn_limit = user
        .get("cdnLimitGb")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let cdn_bytes = if cdn_limit > 0.0 {
        Some(crate::gb_to_bytes_i64(cdn_limit))
    } else {
        None
    };
    let cdn_period = if settings.get("cdnResetPeriod").and_then(Value::as_str) == Some("monthly") {
        "month"
    } else {
        "lifetime"
    };
    let node_usage = node_user_quotas::usage_for_user(&state.pool, id)
        .await
        .map_err(Problem::from)?;
    let mut nodes = Vec::new();
    if let Some(policies) = user.get("nodeTrafficLimits").and_then(Value::as_object) {
        for key in policies.keys() {
            let node_id = key.parse::<i64>().map_err(|_| Problem::unavailable())?;
            let rule = node_user_quotas::rule_for(&user, node_id)
                .map_err(|()| Problem::unavailable())?
                .ok_or_else(Problem::unavailable)?;
            let usage = node_usage.get(&node_id).copied().unwrap_or_default();
            let metered_node_bytes = match rule.period {
                "daily" => usage.daily,
                "weekly" => usage.weekly,
                "monthly" => usage.monthly,
                _ => usage.lifetime,
            };
            let period = match rule.period {
                "daily" => "day",
                "weekly" => "week",
                "monthly" => "month",
                _ => "lifetime",
            };
            let mut value = bucket("node", Some(rule.limit_bytes), metered_node_bytes, period);
            value["nodeId"] = json!(node_id);
            nodes.push(value);
        }
    } else if user.get("nodeTrafficLimits").is_some() {
        // Never report "unlimited" if a persisted quota map is corrupt.
        return Err(Problem::unavailable());
    }
    Ok((
        json!({
            "userId": id,
            "main": bucket("main", main_bytes, used_bytes, "lifetime"),
            "cdn": bucket("cdn", cdn_bytes, cdn_used, cdn_period),
            "nodes": nodes
        }),
        revision,
    ))
}

fn with_etag(value: Value, revision: i64) -> Result<Response, Problem> {
    let mut response = reply(value).into_response();
    let etag =
        HeaderValue::from_str(&format!("\"{revision}\"")).map_err(|_| Problem::unavailable())?;
    response.headers_mut().insert(header::ETAG, etag);
    Ok(response)
}

pub(super) async fn get(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Response, Problem> {
    principal.allow_scope("quotas:read")?;
    principal.allow_user(id)?;
    let (result, revision) = view(&state, id).await?;
    with_etag(result, revision)
}

async fn apply(
    tx: &mut Transaction<'_, Postgres>,
    id: i64,
    headers: &HeaderMap,
    policy: &Map<String, Value>,
) -> Result<i64, Problem> {
    let row = sqlx::query(
        "SELECT data,(EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision
         FROM panel_records WHERE collection='users' AND id=$1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND, "not_found", "User not found"))?;
    user_mutations::matches_revision(headers, row.try_get("revision")?)?;
    let mut user: Value = row.try_get("data")?;
    let object = user.as_object_mut().ok_or_else(Problem::unavailable)?;
    for (field, value) in policy {
        object.insert(field.clone(), value.clone());
    }
    crate::validate_record("users", &user).map_err(Problem::from)?;
    if policy.contains_key("nodeTrafficLimits") {
        node_user_quotas::require_existing_nodes(tx, &user)
            .await
            .map_err(Problem::from)?;
    }
    let updated = sqlx::query(
        "UPDATE panel_records SET data=$2,updated_at=NOW()
         WHERE collection='users' AND id=$1
         RETURNING (EXTRACT(EPOCH FROM updated_at)*1000000)::BIGINT AS revision",
    )
    .bind(id)
    .bind(&user)
    .fetch_one(&mut **tx)
    .await?;
    Ok(updated.try_get("revision")?)
}

pub(super) async fn patch(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Response, Problem> {
    principal.allow_scope("quotas:write")?;
    principal.allow_user(id)?;
    let policy = parse_policy(&body)?;
    let key = grants::key(&headers)?;
    let hash = grants::request_hash("user.quotas.patch", id, &body)?;
    let mut tx = state.pool.begin().await?;
    let replayed = if grants::claim(&mut tx, &principal, &key, "user.quotas.patch", &hash)
        .await?
        .is_some()
    {
        true
    } else {
        let revision = apply(&mut tx, id, &headers, &policy).await?;
        grants::complete(
            &mut tx,
            &principal,
            &key,
            "user.quotas.patch",
            id,
            &json!({"userId":id,"revision":revision}),
        )
        .await?;
        false
    };
    tx.commit().await?;
    let (result, revision) = view(&state, id).await?;
    let mut response = with_etag(result, revision)?;
    if replayed {
        // A replay never mutates the record, even when the ETag has changed.
        response
            .headers_mut()
            .insert("x-idempotency-replayed", HeaderValue::from_static("true"));
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_rejects_meter_forgery_unknown_fields_and_duplicate_nodes() {
        for value in [
            json!({"cdnUsedBytes":0}),
            json!({"usedGb":0}),
            json!({"nodeRules":[{"nodeId":1,"period":"day","limitGb":5},{"nodeId":1,"period":"day","limitGb":2}]}),
            json!({"nodeRules":[{"nodeId":1,"period":"hour","limitGb":5}]}),
            json!({"nodeRules":[{"nodeId":1,"period":"day","limitGb":0}]}),
            json!({}),
        ] {
            assert!(parse_policy(&value).is_err(), "{value}");
        }
        let accepted = parse_policy(&json!({
            "limitGb":0,"cdnLimitGb":5,"nodeRules":[{"nodeId":123,"period":"week","limitGb":0.5}]
        }))
        .unwrap();
        assert_eq!(accepted["nodeTrafficLimits"]["123"]["period"], "weekly");
        assert_eq!(accepted["cdnLimitGb"], 5.0);
    }
    #[test]
    fn exact_limits_do_not_change_signed_meters() {
        let limits = parse_policy(&json!({"limitGb":1000,"cdnLimitGb":5})).unwrap();
        assert!(!limits.contains_key("used"));
        assert!(!limits.contains_key("cdnUsedBytes"));
        assert_eq!(
            bucket("main", Some(100), 150, "lifetime")["remainingBytes"],
            0
        );
        assert!(bucket("main", None, 150, "lifetime")["remainingBytes"].is_null());
    }
}
