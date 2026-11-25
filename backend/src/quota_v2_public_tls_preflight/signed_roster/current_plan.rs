//! Check the authoritative plan for every signed first-cap user while the
//! normal allocator's advisory, user, account and lease locks are held.
//! No positive authority and no persistent diagnostic writes.
use crate::{ApiError, node_runtime, quota_v2, quota_v2_cap_delivery};
use serde_json::Value;
use sqlx::PgConnection;

pub(super) struct LockedUser {
    pub(super) id: i64,
    pub(super) record: Value,
}

/// Use the existing allocator lock order. Acquire all users in canonical
/// order BEFORE the serialized SQL account/lease gate (migration 0169).
pub(super) async fn lock_users(
    conn: &mut PgConnection,
    ids: &[i64],
) -> Result<Option<Vec<LockedUser>>, sqlx::Error> {
    let mut users = Vec::with_capacity(ids.len());
    for &id in ids {
        let Some(record) = quota_v2_cap_delivery::lock_signed_user(conn, id).await? else {
            return Ok(None);
        };
        users.push(LockedUser { id, record });
    }
    Ok(Some(users))
}

fn class(payload: &Value) -> Option<&'static str> {
    let aliases = payload.get("aliasScopes")?.as_array()?;
    let main = aliases.iter().any(|a| a["class"] == "main");
    let cdn = aliases.iter().any(|a| a["class"] == "cdn");
    match (main, cdn) {
        (true, true) => Some("mixed"),
        (true, false) => Some("main"),
        (false, true) => Some("cdn"),
        (false, false) => None,
    }
}

fn current_credential(user: &Value, original: &str) -> bool {
    uuid::Uuid::parse_str(original).is_ok_and(|id| id.to_string() == original)
        && user["xrayId"].as_str() == Some(original)
}

pub(super) async fn check_users(
    conn: &mut PgConnection,
    node: i64,
    users: &[LockedUser],
    credentials: &[String],
    grants: &[(i64, Vec<u8>)],
) -> Result<bool, ApiError> {
    if users.len() != credentials.len() || users.len() != grants.len() {
        return Ok(false);
    }
    // The active product enrollment is locked by 0169. Also lock the
    // authoritative panel node and the exact current hybrid request keyset.
    let active: Option<i64> = sqlx::query_scalar(
        "SELECT n.id FROM panel_records n
         JOIN node_xsp_product_nodes p ON p.node_id=n.id
         JOIN node_xsp_public_keysets k ON k.node_id=p.node_id
              AND k.purpose='node_request' AND k.key_epoch=p.key_epoch
              AND k.ed25519_key_id=p.ed25519_key_id AND k.mldsa65_key_id=p.mldsa65_key_id
         WHERE n.id=$1 AND n.collection='nodes' AND p.state='active'
           AND k.revoked_at IS NULL
           AND (n.data->'disabled') IS DISTINCT FROM 'true'::jsonb
         FOR SHARE OF n,k",
    )
    .bind(node)
    .fetch_optional(&mut *conn)
    .await?;
    if active.is_none() {
        return Ok(false);
    }

    for ((user, credential), (id, raw)) in users.iter().zip(credentials).zip(grants) {
        if user.id != *id || !current_credential(&user.record, credential) {
            return Ok(false);
        }
        let Ok(doc) = serde_json::from_slice::<Value>(raw) else {
            return Ok(false);
        };
        if !check_one(conn, node, user, &doc["payload"]).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn check_one(
    conn: &mut PgConnection,
    node: i64,
    user: &LockedUser,
    payload: &Value,
) -> Result<bool, ApiError> {
    let (Some(class), Some(reservation), Some(epoch), Some(expires), Some(ceiling)) = (
        class(payload),
        payload["reservationId"].as_str(),
        payload["accountEpoch"].as_str(),
        payload["validUntilMs"].as_i64(),
        payload["sharedCeilingBytes"].as_i64(),
    ) else {
        return Ok(false);
    };
    let now: i64 =
        sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT")
            .fetch_one(&mut *conn)
            .await?;
    let account: Option<i64> = sqlx::query_scalar(
        "SELECT limit_bytes FROM quota_v2_accounts
         WHERE user_id=$1 AND epoch=$2::uuid AND NOT closed",
    )
    .bind(user.id)
    .bind(epoch)
    .fetch_optional(&mut *conn)
    .await?;
    if account.is_none()
        || quota_v2::authoritative_shared_limit(&user.record).ok() != account
        || !node_runtime::first_genesis_active_until(&user.record, now, expires)
        || !node_runtime::first_genesis_rehearsal_limits_supported(
            &user.record,
            node,
            class != "main",
        )
        || !crate::quota_v2_cdn_lifetime::supported(&user.record, class)
    {
        return Ok(false);
    }

    // Reuse the real cap delivery rules instead of interpreting a signed
    // historical byte ceiling as proof that the owner's CURRENT plan funds it.
    crate::quota_v2_cdn_lifetime::verify_class(conn, user.id, node, reservation, class).await?;
    if !crate::quota_v2_node_lifetime::issued_within_limit(conn, user.id, node, &user.record)
        .await?
        || !crate::quota_v2_cdn_lifetime::issued_within_limit(conn, user.id, &user.record, class)
            .await?
    {
        return Ok(false);
    }
    let closed: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM quota_v2_calendar_closures WHERE reservation_id=$1::uuid)",
    )
    .bind(reservation)
    .fetch_one(&mut *conn)
    .await?;
    let node_end =
        crate::quota_v2_node_lifetime::permit_deadline(conn, node, &user.record, reservation)
            .await?;
    let cdn_end =
        crate::quota_v2_cdn_lifetime::permit_deadline(conn, &user.record, reservation, class)
            .await?;
    if closed || node_end.into_iter().chain(cdn_end).any(|end| expires > end) {
        return Ok(false);
    }
    let cdn = crate::quota_v2_cdn_lifetime::signed_cdn_ceiling(
        conn,
        reservation,
        user.id,
        node,
        &user.record,
        class,
        ceiling,
    )
    .await?;
    Ok(payload["cdnCeilingBytes"].as_i64() == Some(cdn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn current_credential_must_match_the_original_canonical_uuid() {
        let id = "12345678-1234-4234-8234-123456789abc";
        assert!(current_credential(&json!({"xrayId":id}), id));
        assert!(!current_credential(&json!({"xrayId":id}), &id.to_uppercase()));
        assert!(!current_credential(&json!({"xrayId":"other"}), id));
        assert!(!current_credential(&json!({}), id));
    }
}
