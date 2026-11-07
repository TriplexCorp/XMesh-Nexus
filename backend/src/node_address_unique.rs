//! Prevent accidental duplicate Node registration through the generic collection API.
//! The transaction-level lock serializes same-address writes across API replicas.
use std::net::IpAddr;

use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{Postgres, Row, Transaction};

use crate::ApiError;

/// Canonicalize IP spellings (especially IPv6) and case-insensitive DNS names.
pub(crate) fn address_key(data: &Value) -> Option<String> {
    let address = data.get("addr")?.as_str()?;
    Some(
        address
            .parse::<IpAddr>()
            .map_or_else(|_| address.to_ascii_lowercase(), |ip| ip.to_string()),
    )
}

/// Must be called inside the *same* transaction as INSERT or UPDATE, after
/// validate_node_address. For updates, skip this check when the address has
/// not actually changed, so legacy duplicates can still be edited or removed.
pub(crate) async fn reject_duplicate(
    tx: &mut Transaction<'_, Postgres>,
    data: &Value,
    current_id: i64,
) -> Result<(), ApiError> {
    let address = address_key(data).ok_or_else(|| {
        ApiError::new(StatusCode::BAD_REQUEST, "Укажите IP-адрес или домен узла.")
    })?;

    // A preflight SELECT without a transaction lock is racy: two parallel POSTs
    // would both observe that the address is free. This lock lives until commit
    // or rollback, protecting the subsequent read and write as one operation.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("xmesh:node-address:{address}"))
        .execute(&mut **tx)
        .await?;

    let rows = sqlx::query(
        "SELECT id, data FROM panel_records WHERE collection='nodes' AND id <> $1",
    )
    .bind(current_id)
    .fetch_all(&mut **tx)
    .await?;

    for row in rows {
        let existing: Value = row.try_get("data")?;
        if address_key(&existing).as_deref() != Some(address.as_str()) {
            continue;
        }

        let id: i64 = row.try_get("id")?;
        let name = existing
            .get("name")
            .or_else(|| existing.get("remark"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                value
                    .chars()
                    .filter(|character| !character.is_control())
                    .take(80)
                    .collect::<String>()
            })
            .unwrap_or_else(|| format!("Узел #{id}"));
        let kind = if address.parse::<IpAddr>().is_ok() {
            "IP-адресом"
        } else {
            "адресом"
        };
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            format!(
                "Узел с {kind} {address} уже существует: «{name}» (ID {id}). Откройте существующий узел вместо повторного добавления."
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_ip_and_dns_identity() {
        assert_eq!(
            address_key(&json!({"addr":"2001:0db8:0:0:0:0:0:1"})),
            address_key(&json!({"addr":"2001:db8::1"}))
        );
        assert_eq!(
            address_key(&json!({"addr":"EXAMPLE.COM"})),
            address_key(&json!({"addr":"example.com"}))
        );
        assert_eq!(
            address_key(&json!({"addr":"192.0.2.1"})),
            Some("192.0.2.1".to_owned())
        );
        assert_ne!(
            address_key(&json!({"addr":"192.0.2.1"})),
            address_key(&json!({"addr":"192.0.2.2"}))
        );
        assert_eq!(address_key(&json!({})), None);
    }
}
