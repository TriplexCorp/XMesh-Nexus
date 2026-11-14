//! Read-only, strictly projected squad and node catalog.
//! Avoid exposing saved node addresses, enrollment secrets or Xray configuration.
use super::{Problem, ServicePrincipal, reply};
use crate::AppState;
use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::Row;
use std::collections::HashMap;

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct CatalogQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

#[derive(Clone, Copy)]
enum Kind {
    Squads,
    Nodes,
}
impl Kind {
    const fn collection(self) -> &'static str {
        match self {
            Self::Squads => "squads",
            Self::Nodes => "nodes",
        }
    }
    const fn scope(self) -> &'static str {
        match self {
            Self::Squads => "squads:read",
            Self::Nodes => "nodes:read",
        }
    }
}

const fn invalid_cursor() -> Problem {
    Problem::new(StatusCode::BAD_REQUEST, "validation_error", "Invalid catalog cursor")
}

fn signed_cursor(
    state: &AppState,
    principal: &ServicePrincipal,
    kind: Kind,
    id: i64,
) -> Result<String, Problem> {
    let msg = format!(
        "integration-catalog-v1:{}:{}:{id}",
        principal.client_id, kind.collection()
    );
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.subscription_key)
        .map_err(|_| Problem::unavailable())?;
    mac.update(msg.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(format!(
        "{msg}:{}",
        hex::encode(mac.finalize().into_bytes())
    )))
}

fn verify_cursor(
    state: &AppState,
    principal: &ServicePrincipal,
    kind: Kind,
    input: &str,
) -> Result<i64, Problem> {
    if input.len() > 256 {
        return Err(invalid_cursor());
    }
    let bytes = URL_SAFE_NO_PAD.decode(input).map_err(|_| invalid_cursor())?;
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid_cursor())?;
    let (message, sig) = text.rsplit_once(':').ok_or_else(invalid_cursor)?;
    let (prefix, id) = message.rsplit_once(':').ok_or_else(invalid_cursor)?;
    if prefix != format!(
        "integration-catalog-v1:{}:{}",
        principal.client_id, kind.collection()
    ) {
        return Err(invalid_cursor());
    }
    let id = id.parse::<i64>().ok().filter(|v| *v > 0).ok_or_else(invalid_cursor)?;
    let signature = hex::decode(sig).map_err(|_| invalid_cursor())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.subscription_key)
        .map_err(|_| Problem::unavailable())?;
    mac.update(message.as_bytes());
    mac.verify_slice(&signature).map_err(|_| invalid_cursor())?;
    Ok(id)
}

fn safe_name(value: &Value, id: i64) -> String {
    value.get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map_or_else(|| format!("Record {id}"), str::to_owned)
}

fn squad_view(record: &Value, id: i64, members: i64) -> Value {
    json!({"id":id,"name":safe_name(record,id),"memberCount":members})
}

fn node_view(record: &Value, id: i64) -> Value {
    // A persisted record's fields are not a reliable live-node heartbeat.
    // State is "unknown" unless an explicit supported state is present.
    let status = match record.get("state").and_then(Value::as_str) {
        Some("online") => "online",
        Some("offline") => "offline",
        Some("degraded") => "degraded",
        _ => "unknown",
    };
    let mut result = json!({
        "id":id,
        "name":safe_name(record,id),
        "country":record.get("country").and_then(Value::as_str).unwrap_or(""),
        "state":status
    });
    for key in ["agentVersion", "xrayVersion"] {
        if let Some(value) = record.get(key).and_then(Value::as_str) {
            result[key] = json!(value);
        }
    }
    result
}

async fn member_counts(
    state: &AppState,
    principal: &ServicePrincipal,
) -> Result<HashMap<String, i64>, Problem> {
    // All counts are constrained to the caller's visible users, never a
    // global total disclosed to a token restricted to selected user IDs.
    let rows = sqlx::query(
        "SELECT item.squad_id, COUNT(*)::BIGINT AS members
         FROM panel_records AS u
         CROSS JOIN LATERAL jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(u.data->'squads') = 'array'
           THEN u.data->'squads' ELSE '[]'::jsonb END
         ) AS item(squad_id)
         WHERE u.collection='users'
           AND ($1::BIGINT[] IS NULL OR u.id=ANY($1))
         GROUP BY item.squad_id",
    )
    .bind(principal.allowed_user_ids.clone())
    .fetch_all(&state.pool)
    .await?;
    let mut counts = HashMap::new();
    for row in rows {
        counts.insert(
            row.try_get::<String, _>("squad_id")?,
            row.try_get::<i64, _>("members")?,
        );
    }
    Ok(counts)
}

async fn list_impl(
    state: &AppState,
    principal: &ServicePrincipal,
    query: CatalogQuery,
    kind: Kind,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope(kind.scope())?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Problem::new(StatusCode::BAD_REQUEST, "validation_error", "Invalid page limit"));
    }
    let start = query.cursor.as_deref().map_or(Ok(0), |raw| {
        verify_cursor(state, principal, kind, raw)
    })?;
    let rows = sqlx::query(
        "SELECT id,data FROM panel_records
         WHERE collection=$1 AND id>$2 ORDER BY id LIMIT $3",
    )
    .bind(kind.collection())
    .bind(start)
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;
    let more = rows.len() > usize::try_from(limit).unwrap_or(100);
    let counts = if matches!(kind, Kind::Squads) {
        member_counts(state, principal).await?
    } else {
        HashMap::new()
    };
    let mut items = Vec::new();
    let mut last = start;
    for row in rows.into_iter().take(usize::try_from(limit).unwrap_or(100)) {
        let id: i64 = row.try_get("id")?;
        let data: Value = row.try_get("data")?;
        last = id;
        items.push(match kind {
            Kind::Squads => squad_view(&data, id, *counts.get(&id.to_string()).unwrap_or(&0)),
            Kind::Nodes => node_view(&data, id),
        });
    }
    let mut output = reply(json!(items));
    output.0["meta"]["limit"] = json!(limit);
    output.0["meta"]["nextCursor"] = if more {
        json!(signed_cursor(state, principal, kind, last)?)
    } else {
        Value::Null
    };
    Ok(output)
}

async fn get_impl(
    state: &AppState,
    principal: &ServicePrincipal,
    id: i64,
    kind: Kind,
) -> Result<Json<Value>, Problem> {
    principal.allow_scope(kind.scope())?;
    if id <= 0 {
        return Err(Problem::new(StatusCode::NOT_FOUND, "not_found", "Record not found"));
    }
    let record = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection=$1 AND id=$2",
    )
    .bind(kind.collection())
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| Problem::new(StatusCode::NOT_FOUND,"not_found","Record not found"))?;
    let result = match kind {
        Kind::Squads => {
            let counts = member_counts(state, principal).await?;
            squad_view(&record, id, *counts.get(&id.to_string()).unwrap_or(&0))
        }
        Kind::Nodes => node_view(&record, id),
    };
    Ok(reply(result))
}

pub(super) async fn list_squads(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Query(query): Query<CatalogQuery>,
) -> Result<Json<Value>, Problem> {
    list_impl(&state, &principal, query, Kind::Squads).await
}

pub(super) async fn get_squad(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Problem> {
    get_impl(&state, &principal, id, Kind::Squads).await
}

pub(super) async fn list_nodes(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Query(query): Query<CatalogQuery>,
) -> Result<Json<Value>, Problem> {
    list_impl(&state, &principal, query, Kind::Nodes).await
}

pub(super) async fn get_node(
    State(state): State<AppState>,
    Extension(principal): Extension<ServicePrincipal>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, Problem> {
    get_impl(&state, &principal, id, Kind::Nodes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_projection_never_reveals_node_secrets_or_squad_rules() {
        let node = json!({
            "id":10,"name":"Norway","addr":"10.0.0.1","metricsKey":"PRIVATE",
            "profileId":3,"xrayVersion":"26.1","state":"unexpected",
            "routing":{"rules":[{"ip":"private"}]}
        });
        let safe = node_view(&node,10);
        assert_eq!(safe["state"],"unknown");
        assert_eq!(safe["xrayVersion"],"26.1");
        for key in ["addr","metricsKey","profileId","routing"] {
            assert!(safe.get(key).is_none(), "{key}");
        }
        let squad = squad_view(&json!({"name":"Germany","inb":["vless-private"]}),2,5);
        assert_eq!(squad["memberCount"],5);
        assert!(squad.get("inb").is_none());
    }
}
