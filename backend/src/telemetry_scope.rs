//! Authorize signed node telemetry against the *current* node/user assignment.
//!
//! A valid node signature proves which node submitted the counters; it does not
//! permit that node to choose arbitrary user IDs. Check before touching any
//! user presence, first-connection, quota or traffic ledger state.
use crate::{ApiError, UserInboundTrafficSample, UserTrafficSample};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{PgConnection, Row};
use std::collections::{HashMap, HashSet};

fn forbidden() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "Node telemetry user or inbound is outside its assigned profile scope.",
    )
}

fn node_profile_id(node: &Value) -> Option<i64> {
    node.get("profileId")
        .and_then(|value| {
            value.as_i64().or_else(|| {
                value.as_str().and_then(|text| text.parse::<i64>().ok())
            })
        })
        .filter(|id| *id > 0)
}

fn configured_proxy_tags(profile: &Value) -> Result<HashSet<String>, ApiError> {
    let source = profile.get("config").ok_or_else(forbidden)?;
    let config = if let Some(text) = source.as_str() {
        serde_json::from_str::<Value>(text).map_err(|_| forbidden())?
    } else {
        source.clone()
    };
    let allowed_protocols = ["vless", "vmess", "trojan", "shadowsocks", "hysteria", "masque"];
    let tags = config
        .get("inbounds")
        .and_then(Value::as_array)
        .ok_or_else(forbidden)?
        .iter()
        .filter(|inbound| {
            inbound.get("protocol").and_then(Value::as_str)
                .is_some_and(|protocol| allowed_protocols.contains(&protocol))
                && inbound.get("settings").is_some_and(Value::is_object)
        })
        .filter_map(|inbound| inbound.get("tag").and_then(Value::as_str))
        .filter(|tag| !tag.is_empty())
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    if tags.is_empty() {
        return Err(forbidden());
    }
    Ok(tags)
}

fn assigned_tags(
    user_id: i64,
    user_squads: &HashMap<i64, Vec<i64>>,
    squad_tags: &HashMap<i64, HashSet<String>>,
) -> HashSet<String> {
    user_squads
        .get(&user_id)
        .into_iter()
        .flatten()
        .filter_map(|id| squad_tags.get(id))
        .flat_map(|tags| tags.iter().cloned())
        .collect()
}

/// A signed telemetry packet is rejected atomically if even one user is not
/// authorized for the reporting node. Inbound counters additionally require
/// an exact authorized inbound tag; user-wide counters require at least one.
pub async fn verify(
    conn: &mut PgConnection,
    node_id: i64,
    user_traffic: &[UserTrafficSample],
    inbound_traffic: &[UserInboundTrafficSample],
) -> Result<(), ApiError> {
    let mut user_ids = user_traffic
        .iter()
        .map(|sample| sample.user_id)
        .chain(inbound_traffic.iter().map(|sample| sample.user_id))
        .collect::<Vec<_>>();
    user_ids.sort_unstable();
    user_ids.dedup();
    if user_ids.is_empty() {
        return Ok(());
    }

    let node = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='nodes' AND id=$1",
    )
    .bind(node_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(forbidden)?;
    let profile_id = node_profile_id(&node).ok_or_else(forbidden)?;
    let profile = sqlx::query_scalar::<_, Value>(
        "SELECT data FROM panel_records WHERE collection='profiles' AND id=$1",
    )
    .bind(profile_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(forbidden)?;
    let profile_tags = configured_proxy_tags(&profile)?;

    let rows = sqlx::query(
        "SELECT id,data FROM panel_records WHERE collection='users' AND id=ANY($1::BIGINT[])",
    )
    .bind(&user_ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut user_squads = HashMap::new();
    let mut squad_ids = Vec::new();
    for row in rows {
        let id: i64 = row.try_get("id")?;
        let user: Value = row.try_get("data")?;
        let ids = user
            .get("squads")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .collect::<Vec<_>>();
        squad_ids.extend_from_slice(&ids);
        user_squads.insert(id, ids);
    }
    squad_ids.sort_unstable();
    squad_ids.dedup();
    let rows = sqlx::query(
        "SELECT id,data FROM panel_records WHERE collection='squads' AND id=ANY($1::BIGINT[])",
    )
    .bind(&squad_ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut squad_tags = HashMap::new();
    for row in rows {
        let id: i64 = row.try_get("id")?;
        let squad: Value = row.try_get("data")?;
        let tags = squad
            .get("inb")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|tag| profile_tags.contains(*tag))
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        squad_tags.insert(id, tags);
    }
    // This is checked before persisting *any* user counter in the current
    // transaction; no onlineAt, hold timer, traffic or quota row is mutated.
    for sample in user_traffic {
        if assigned_tags(sample.user_id, &user_squads, &squad_tags).is_empty() {
            return Err(forbidden());
        }
    }
    for sample in inbound_traffic {
        if !assigned_tags(sample.user_id, &user_squads, &squad_tags)
            .contains(&sample.inbound_tag)
        {
            return Err(forbidden());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{assigned_tags, configured_proxy_tags, node_profile_id};
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

    #[test]
    fn profile_scope_ignores_non_proxy_inbounds() {
        let profile = json!({"config":json!({"inbounds":[
            {"tag":"DE_VLESS","protocol":"vless","settings":{"clients":[]}},
            {"tag":"xmesh_stats_in","protocol":"dokodemo-door","settings":{}},
            {"tag":"CDN_DE","protocol":"vless","settings":{"clients":[]}}
        ]}).to_string()});
        let tags = configured_proxy_tags(&profile).unwrap();
        assert_eq!(tags, HashSet::from(["DE_VLESS".to_owned(), "CDN_DE".to_owned()]));
        assert!(node_profile_id(&json!({"profileId":"51"})) == Some(51));
        assert!(node_profile_id(&json!({"profileId":"not-a-number"})).is_none());
    }

    #[test]
    fn unrelated_users_and_unassigned_inbounds_fail_closed() {
        let user_squads = HashMap::from([
            (10_i64, vec![1_i64]),
            (20_i64, vec![2_i64]),
            (30_i64, Vec::new()),
        ]);
        let squad_tags = HashMap::from([
            (1_i64, HashSet::from(["DE_VLESS".to_owned()])),
            (2_i64, HashSet::new()),
        ]);
        assert_eq!(
            assigned_tags(10, &user_squads, &squad_tags),
            HashSet::from(["DE_VLESS".to_owned()])
        );
        assert!(assigned_tags(20, &user_squads, &squad_tags).is_empty());
        assert!(assigned_tags(30, &user_squads, &squad_tags).is_empty());
        assert!(assigned_tags(999, &user_squads, &squad_tags).is_empty());
    }
}
