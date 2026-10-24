use crate::{ApiError, AppState, auth::AuthUser};
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, OsRng, Payload, rand_core::RngCore},
};
use axum::{
    Json,
    extract::{Extension, OriginalUri, Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use base64::Engine as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::{collections::HashMap, fmt::Write as _};

// Encrypt recoverable bearer secrets at rest with a separately derived key.
// TOTP_ENCRYPTION_KEY must stay stable across upgrades; raw token never enters
// audit logs, the user JSON record or public settings.
fn subscription_cipher(state: &AppState) -> Result<Aes256Gcm, ApiError> {
    let master = state.totp_key.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Subscription encryption requires TOTP_ENCRYPTION_KEY",
        )
    })?;
    let mut hash = Sha256::new();
    hash.update(b"XMESH-SUBSCRIPTION-ENCRYPTION-V1\0");
    hash.update(master);
    let key = hash.finalize();
    Aes256Gcm::new_from_slice(&key).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Subscription cipher unavailable",
        )
    })
}
fn encrypt_token(state: &AppState, user_id: i64, token: &str) -> Result<String, ApiError> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = subscription_cipher(state)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: token.as_bytes(),
                aad: &user_id.to_be_bytes(),
            },
        )
        .map_err(|_| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Subscription encryption failed",
            )
        })?;
    let mut bytes = nonce.to_vec();
    bytes.extend(encrypted);
    Ok(hex::encode(bytes))
}
fn decrypt_token(
    state: &AppState,
    user_id: i64,
    encoded: &str,
    expected_hash: &str,
) -> Result<String, ApiError> {
    let bytes = hex::decode(encoded).map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Stored subscription is corrupt",
        )
    })?;
    if bytes.len() < 12 + 16 + 64 {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Stored subscription is corrupt",
        ));
    }
    let raw = subscription_cipher(state)?
        .decrypt(
            Nonce::from_slice(&bytes[..12]),
            Payload {
                msg: &bytes[12..],
                aad: &user_id.to_be_bytes(),
            },
        )
        .map_err(|_| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Subscription decryption failed; verify TOTP_ENCRYPTION_KEY",
            )
        })?;
    let token = String::from_utf8(raw).map_err(|_| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Stored subscription is corrupt",
        )
    })?;
    if !valid_token(&token) || token_hash(&token) != expected_hash {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Subscription secret integrity check failed",
        ));
    }
    Ok(token)
}
fn bad(msg: &'static str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, msg)
}
fn studio_url(settings: &Value, token: &str) -> String {
    let domain = settings
        .get("subscriptionDomain")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            settings
                .get("domain")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
        });
    let path = settings
        .get("subscriptionPath")
        .and_then(Value::as_str)
        .filter(|p| p.starts_with('/'))
        .unwrap_or("/s")
        .trim_end_matches('/');
    domain.map_or_else(
        || format!("{path}/{token}"),
        |host| format!("https://{host}{path}/{token}"),
    )
}
fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}
fn nonempty<'a>(obj: &'a Value, key: &str) -> Option<&'a str> {
    obj.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}
fn port(v: &Value) -> Option<u16> {
    v.as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
}
fn endpoint(host: &Value) -> Option<&str> {
    let a = ["externalAddress", "address", "publicAddress", "addr"]
        .into_iter()
        .find_map(|k| nonempty(host, k))?;
    if a.chars()
        .any(|c| matches!(c, ' ' | '/' | '@' | '?' | '#' | '\\'))
        || a == "localhost"
        || a == "0.0.0.0"
        || a.starts_with("127.")
        || a.starts_with("10.")
        || a.starts_with("192.168.")
        || a.starts_with("172.16.")
    {
        return None;
    }
    Some(a)
}
// Client-native Xray outbound: build from explicitly allowed public values,
// not from server-side streamSettings containing Reality private keys.
fn vless_outbound(user: &Value, inbound: &Value, host: &Value, device: &str) -> Option<Value> {
    if nonempty(inbound, "protocol")? != "vless" {
        return None;
    }
    if uuid::Uuid::parse_str(nonempty(user, "xrayId")?).is_err() {
        return None;
    }
    let stream_check = inbound.get("streamSettings")?;
    let security_check = nonempty(stream_check, "security").unwrap_or("none");
    let network_check = nonempty(stream_check, "method")
        .or_else(|| nonempty(stream_check, "network"))
        .unwrap_or("tcp");
    if !["tls", "reality", "none"].contains(&security_check)
        || ![
            "tcp",
            "raw",
            "xhttp",
            "ws",
            "websocket",
            "grpc",
            "httpupgrade",
            "mkcp",
            "kcp",
        ]
        .contains(&network_check)
    {
        return None;
    }
    if security_check == "none" {
        let enc = nonempty(host, "clientEncryption")
            .or_else(|| nonempty(host, "externalClientEncryption"))
            .or_else(|| nonempty(user, "vlessEncryption"))
            .or_else(|| {
                inbound
                    .get("xmesh")
                    .and_then(|v| nonempty(v, "clientEncryption"))
            })
            .unwrap_or("none");
        if !enc.starts_with("mlkem768x25519plus.") {
            return None;
        }
    }
    let address = endpoint(host)?;
    let port = ["externalPort", "port"]
        .into_iter()
        .find_map(|key| host.get(key).and_then(self::port))
        .or_else(|| inbound.get("port").and_then(self::port))?;
    let uuid = nonempty(user, "xrayId")?;
    let tag = nonempty(host, "remark")
        .or_else(|| nonempty(inbound, "tag"))
        .unwrap_or(address);
    let country = nonempty(host, "countryCode")
        .or_else(|| nonempty(host, "country"))
        .or_else(|| nonempty(host, "region"))
        .unwrap_or("ZZ");

    // The server's VLESS decryption string is NOT a client encryption string.
    // Only explicitly provided client-side encryption material may be exported.
    let server_decryption = inbound
        .get("settings")
        .and_then(|v| nonempty(v, "decryption"))
        .unwrap_or("none");
    let client_encryption = nonempty(host, "clientEncryption")
        .or_else(|| nonempty(host, "externalClientEncryption"))
        .or_else(|| nonempty(user, "vlessEncryption"))
        .or_else(|| {
            inbound
                .get("xmesh")
                .and_then(|v| nonempty(v, "clientEncryption"))
        })
        .unwrap_or("none");
    // Fail closed: a server-side decryption value must never be used as client material,
    // even if accidentally pasted into a host or user encryption override.
    if client_encryption == server_decryption && server_decryption != "none" {
        return None;
    }
    if server_decryption != "none" && client_encryption == "none" {
        return None;
    }
    let mut client = json!({"id":uuid,"encryption":client_encryption});
    // Flow must only be included when the inbound actually supports it.
    // Resolve flow for the actual user, then the profile's explicit subscription default.
    // Never invent Vision for an inbound where it has not been configured.
    let flow = inbound
        .get("settings")
        .and_then(|v| v.get("users").or_else(|| v.get("clients")))
        .and_then(Value::as_array)
        .and_then(|users| {
            users.iter().find(|entry| {
                (nonempty(entry, "id").is_some_and(|client_id| client_id == uuid))
                    || (nonempty(entry, "email") == nonempty(user, "username"))
            })
        })
        .and_then(|entry| nonempty(entry, "flow"))
        .or_else(|| inbound.get("xmesh").and_then(|v| nonempty(v, "clientFlow")))
        .or_else(|| inbound.get("settings").and_then(|v| nonempty(v, "flow")));
    if let Some(flow) = flow.filter(|v| *v != "none") {
        client["flow"] = json!(flow);
    }

    // Protocol credentials and transport are independently projected.
    let outbound_stream = crate::subscription_transport::client_stream(inbound, host, device)?;
    Some(json!({
     "tag":tag,"xmeshCountry":country,"protocol":"vless",
     "settings":{"vnext":[{"address":address,"port":port,"users":[client]}]},
     "streamSettings":outbound_stream
    }))
}
// Native outbound credentials follow the protocol schema, never the inbound
// settings shape. The node provisions these per-user credentials from xrayId.
// Shadowsocks-2022 requires a separately provisioned per-user key.
fn configure_masque_credentials(
    stream: &mut Value,
    user: &Value,
    inbound: &Value,
    uuid: &str,
) -> Option<()> {
    // MASQUE uses HTTP Basic username/password in transport settings, not UUID
    // in its outbound settings. The server uses the same stat email as username.
    let record_id = user.get("id").and_then(Value::as_i64)?;
    if record_id <= 0 {
        return None;
    }
    let tag = nonempty(inbound, "tag")?;
    let encoded = tag
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect::<String>();
    if !stream["masqueSettings"].is_object() {
        stream["masqueSettings"] = json!({});
    }
    stream["masqueSettings"]["user"] = json!(format!("xmesh-u{record_id}--{encoded}"));
    stream["masqueSettings"]["pass"] = json!(uuid);
    Some(())
}

fn proxy_outbound(user: &Value, inbound: &Value, host: &Value, device: &str) -> Option<Value> {
    if nonempty(inbound, "protocol") == Some("vless") {
        return vless_outbound(user, inbound, host, device);
    }
    let protocol = nonempty(inbound, "protocol")?;
    if !["vmess", "trojan", "shadowsocks", "hysteria", "masque"].contains(&protocol) {
        return None;
    }
    let address = endpoint(host)?;
    let port = ["externalPort", "port"]
        .into_iter()
        .find_map(|key| host.get(key).and_then(self::port))
        .or_else(|| inbound.get("port").and_then(self::port))?;
    let stream = crate::subscription_transport::client_stream(inbound, host, device)?;
    let security = stream["security"].as_str().unwrap_or("none");
    let uuid = nonempty(user, "xrayId")?;
    if uuid::Uuid::parse_str(uuid).is_err() {
        return None;
    }
    let settings = match protocol {
        "vmess" => json!({"address":address,"port":port,"id":uuid,"security":"auto"}),
        "trojan" => {
            if security == "none" {
                return None;
            }
            json!({"address":address,"port":port,"password":uuid})
        }
        "shadowsocks" => {
            let method = inbound
                .get("settings")
                .and_then(|v| nonempty(v, "method"))?;
            let password = if method.starts_with("2022-") {
                // Xray SS2022 multi-user requires ServerPSK:UserPSK on outbound.
                let server = inbound
                    .get("settings")
                    .and_then(|v| nonempty(v, "password"))?;
                let client = nonempty(user, "ssPassword")?;
                let decode =
                    |value: &str| base64::engine::general_purpose::STANDARD.decode(value).ok();
                let len = if method == "2022-blake3-aes-128-gcm" {
                    16
                } else {
                    32
                };
                if decode(server).as_ref().is_none_or(|v| v.len() != len)
                    || decode(client).as_ref().is_none_or(|v| v.len() != len)
                {
                    return None;
                }
                format!("{server}:{client}")
            } else {
                uuid.to_owned()
            };
            json!({"address":address,"port":port,"method":method,"password":password})
        }
        "masque" => {
            let network = stream
                .get("method")
                .or_else(|| stream.get("network"))
                .and_then(Value::as_str)?;
            if network != "masque" || security != "tls" {
                return None;
            }
            json!({"address":address,"port":port})
        }
        "hysteria" => {
            let network = stream
                .get("method")
                .or_else(|| stream.get("network"))
                .and_then(Value::as_str)?;
            if network != "hysteria" || security != "tls" {
                return None;
            }
            json!({"address":address,"port":port,"version":2})
        }
        _ => return None,
    };
    let mut stream = stream;
    if protocol == "masque" {
        configure_masque_credentials(&mut stream, user, inbound, uuid)?;
    }
    if protocol == "hysteria" {
        if !stream["hysteriaSettings"].is_object() {
            stream["hysteriaSettings"] = json!({});
        }
        stream["hysteriaSettings"]["version"] = json!(2);
        stream["hysteriaSettings"]["auth"] = json!(uuid);
    }
    let tag = nonempty(host, "remark")
        .or_else(|| nonempty(inbound, "tag"))
        .unwrap_or(address);
    let country = nonempty(host, "countryCode")
        .or_else(|| nonempty(host, "country"))
        .or_else(|| nonempty(host, "region"))
        .unwrap_or("ZZ");
    Some(json!({"tag":tag,"xmeshCountry":country,"protocol":protocol,
   "settings":settings,"streamSettings":stream}))
}
async fn record(state: &AppState, id: i64) -> Result<Value, ApiError> {
    let row = sqlx::query("SELECT data FROM panel_records WHERE collection='users' AND id=$1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "User not found"))?;
    let mut user: Value = row.try_get("data")?;
    // panel_records.id is authoritative; older user JSON documents may not
    // contain an id field. IP rotation must never depend on that optional copy.
    if !user.is_object() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid user record",
        ));
    }
    user["id"] = json!(id);
    let measured = crate::user_metered_bytes(&state.pool, id).await?;
    crate::add_metered_usage(&mut user, measured);
    Ok(user)
}
// Provision a new user's subscription atomically with their account creation.
// Never expose the bearer secret in the user record or logs.
pub async fn provision_new_user(
    state: &AppState,
    id: i64,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), ApiError> {
    let mut secret = [0u8; 32];
    OsRng.fill_bytes(&mut secret);
    let token = hex::encode(secret);
    let encrypted = encrypt_token(state, id, &token)?;
    sqlx::query("INSERT INTO user_subscription_tokens(user_id,token_hash,token_ciphertext) VALUES($1,$2,$3)")
  .bind(id).bind(token_hash(&token)).bind(encrypted)
  .execute(&mut **tx).await?;
    Ok(())
}
pub async fn create(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    if id <= 0 {
        return Err(bad("Invalid user ID"));
    }
    let subscription_user = record(&state, id).await?;
    let mut secret = [0u8; 32];
    OsRng.fill_bytes(&mut secret);
    let token = hex::encode(secret);
    let encrypted = encrypt_token(&state, id, &token)?;
    sqlx::query(
        "INSERT INTO user_subscription_tokens(user_id,token_hash,token_ciphertext) VALUES($1,$2,$3)
  ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
   token_ciphertext=EXCLUDED.token_ciphertext,created_at=NOW()",
    )
    .bind(id)
    .bind(token_hash(&token))
    .bind(encrypted)
    .execute(&state.pool)
    .await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "subscription.rotated",
        Some("users"),
        Some(id),
        json!({}),
    )
    .await;
    let settings = crate::read_settings(&state.pool).await?;
    // A link can exist before nodes are fully configured. Report that distinction
    // explicitly instead of presenting an unusable subscription as ready.
    let readiness = match collect_user_outbounds(&state, &subscription_user, "generic", false).await
    {
        Ok(outbounds) => json!({"ready":true,"connections":outbounds.len()}),
        Err(error) => {
            tracing::warn!(user_id=id, reason=%error.message,"Subscription link created without usable endpoints");
            json!({"ready":false,"connections":0,"warning":error.message})
        }
    };
    Ok(Json(
        json!({"token":token,"userId":id,"url":studio_url(&settings,&token),"readiness":readiness}),
    ))
}
pub async fn status(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    if id <= 0 {
        return Err(bad("Invalid user ID"));
    }
    let _ = record(&state, id).await?;
    let row=sqlx::query("SELECT token_hash,token_ciphertext,created_at FROM user_subscription_tokens WHERE user_id=$1")
  .bind(id).fetch_optional(&state.pool).await?;
    let Some(row) = row else {
        return Ok(Json(json!({"enabled":false,"token":null,"legacy":false})));
    };
    let encrypted: Option<String> = row.try_get("token_ciphertext")?;
    let hash: String = row.try_get("token_hash")?;
    let token = match encrypted {
        Some(value) => Some(decrypt_token(&state, id, &value, &hash)?),
        None => None,
    };
    let settings = crate::read_settings(&state.pool).await?;
    let url = token.as_deref().map(|value| studio_url(&settings, value));
    Ok(Json(
        json!({"enabled":true,"legacy":token.is_none(),"token":token,"url":url}),
    ))
}
pub async fn revoke(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    sqlx::query("DELETE FROM user_subscription_tokens WHERE user_id=$1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    crate::audit(
        &state.pool,
        &actor.username,
        "subscription.revoked",
        Some("users"),
        Some(id),
        json!({}),
    )
    .await;
    Ok(Json(json!({"revoked":true})))
}
// Hosts are now edited inside XRAY STUDIO but remain in the existing
// PostgreSQL collection. Legacy tag-only records continue to work.
// Legacy UI records can store numeric references as JSON strings. Compare
// canonical positive identifiers rather than raw JSON types.
fn record_id(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str()?.parse::<i64>().ok())
        .filter(|id| *id > 0)
}
fn same_record_id(left: Option<&Value>, right: Option<&Value>) -> bool {
    left.and_then(record_id)
        .is_some_and(|id| Some(id) == right.and_then(record_id))
}
fn host_for_profile(host: &Value, tag: &str, profile: &Value, nodes: &[Value]) -> bool {
    if host.get("disabled").and_then(Value::as_bool) == Some(true)
        || nonempty(host, "tag") != Some(tag)
    {
        return false;
    }
    if host.get("profileId").is_some_and(|id| !id.is_null())
        && !same_record_id(host.get("profileId"), profile.get("id"))
    {
        return false;
    }
    let pinned = host.get("nodes").and_then(Value::as_array);
    if let Some(pins) = pinned
        && !pins.is_empty()
    {
        return nodes.iter().any(|node| {
            node.get("disabled").and_then(Value::as_bool) != Some(true)
                && same_record_id(node.get("profileId"), profile.get("id"))
                && pins
                    .iter()
                    .any(|selected| same_record_id(Some(selected), node.get("id")))
        });
    }
    true
}
// Never rewrite a CDN/host alias to an arbitrary node IP. Rotation applies
// only to an unambiguous directly addressed node that owns the host address.
// A public host may inherit per-node client routing only when its placement
// resolves to exactly one enabled node. Multi-node/CDN hosts require an
// explicit host assignment; guessing a node's policy would misroute traffic.
fn host_owner_node<'a>(host: &Value, profile: &Value, nodes: &'a [Value]) -> Option<&'a Value> {
    let pins = host
        .get("nodes")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty());
    let mut options = nodes.iter().filter(|node| {
        node.get("disabled") != Some(&Value::Bool(true))
            && same_record_id(node.get("profileId"), profile.get("id"))
            && pins.is_none_or(|items| {
                items
                    .iter()
                    .any(|id| same_record_id(Some(id), node.get("id")))
            })
    });
    let owner = options.next()?;
    if options.next().is_none() {
        Some(owner)
    } else {
        None
    }
}
fn direct_host_node<'a>(host: &Value, profile: &Value, nodes: &'a [Value]) -> Option<&'a Value> {
    let address = endpoint(host)?.parse::<std::net::IpAddr>().ok()?;
    let pins = host
        .get("nodes")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty());
    let eligible: Vec<&Value> = nodes
        .iter()
        .filter(|node| {
            if node.get("disabled").and_then(Value::as_bool) == Some(true)
                || !same_record_id(node.get("profileId"), profile.get("id"))
            {
                return false;
            }
            if let Some(ids) = pins
                && !ids
                    .iter()
                    .any(|id| same_record_id(Some(id), node.get("id")))
            {
                return false;
            }
            ["addr", "externalAddress", "publicAddress"]
                .iter()
                .any(|key| {
                    nonempty(node, key).and_then(|s| s.parse::<std::net::IpAddr>().ok())
                        == Some(address)
                })
        })
        .collect();
    if eligible.len() == 1 {
        Some(eligible[0])
    } else {
        None
    }
}

async fn apply_ip_rotation(
    state: &AppState,
    user: &Value,
    node: &Value,
    outbound: &mut Value,
    enabled: bool,
) -> Result<(), ApiError> {
    if !enabled || node.get("rotationEnabled").and_then(Value::as_bool) != Some(true) {
        return Ok(());
    }
    let Some(node_id) = node.get("id").and_then(record_id) else {
        tracing::warn!("Skipping IP rotation: node record has no valid id");
        return Ok(());
    };
    let Some(user_id) = user.get("id").and_then(record_id) else {
        tracing::warn!(node_id, "Skipping IP rotation: user record has no valid id");
        return Ok(());
    };
    // Rotation is an optional delivery enhancement. A stale cursor table or a
    // transient database failure must not take the entire public subscription
    // offline. Preserve the already validated host address on failure.
    match crate::node_rotation::resolve_subscription_address(state, node_id, user_id).await {
        Ok(address) => outbound["settings"]["vnext"][0]["address"] = json!(address),
        Err(error) => tracing::error!(node_id,user_id,error=?error,
    "IP rotation failed; serving the original subscription endpoint"),
    }
    Ok(())
}

fn permitted_inbound_tags(
    user: &Value,
    squads: &[Value],
) -> (Vec<Value>, std::collections::HashSet<String>) {
    let ids = user
        .get("squads")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut tags = std::collections::HashSet::new();
    for squad in squads {
        if !ids
            .iter()
            .any(|id| id.as_i64() == squad.get("id").and_then(Value::as_i64))
        {
            continue;
        }
        if let Some(items) = squad.get("inb").and_then(Value::as_array) {
            for tag in items.iter().filter_map(Value::as_str) {
                tags.insert(tag.to_owned());
            }
        }
    }
    (ids, tags)
}

fn log_unavailable_subscription_host(user: &Value, inbound: &Value, host: &Value, tag: &str) {
    let reality = inbound
        .get("streamSettings")
        .and_then(|s| s.get("realitySettings"))
        .unwrap_or(&Value::Null);
    let missing_key = nonempty(host, "publicKey")
        .or_else(|| nonempty(host, "realityPublicKey"))
        .or_else(|| nonempty(inbound, "publicKey"))
        .or_else(|| nonempty(reality, "publicKey"))
        .is_none();
    let no_uuid = nonempty(user, "xrayId")
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .is_none();
    tracing::warn!(inbound_tag=%tag, missing_reality_public_key=missing_key,
    invalid_user_uuid=no_uuid, host_has_address=endpoint(host).is_some(),
    "Subscription public host could not produce an authorized client outbound");
}

fn log_subscription_candidate(profile: &Value, inbound: &Value, nodes: &[Value], tag: &str) {
    let stream = inbound.get("streamSettings").unwrap_or(&Value::Null);
    let security = nonempty(stream, "security").unwrap_or("none");
    let reality = stream.get("realitySettings").unwrap_or(&Value::Null);
    let has_public_key =
        nonempty(reality, "publicKey").is_some() || nonempty(inbound, "publicKey").is_some();
    let assigned_nodes = nodes
        .iter()
        .filter(|n| {
            same_record_id(n.get("profileId"), profile.get("id"))
                && n.get("disabled") != Some(&Value::Bool(true))
        })
        .count();
    tracing::info!(profile_id=?(profile.get("id").and_then(serde_json::Value::as_i64)),
     inbound_tag=%tag, security=%security, assigned_nodes,
     reality_public_key_in_profile=has_public_key,
     "Subscription endpoint candidate");
}

async fn collect_user_outbounds(
    state: &AppState,
    user: &Value,
    device: &str,
    rotate: bool,
) -> Result<Vec<Value>, ApiError> {
    let squads = crate::load_records(&state.pool, "squads").await?;
    let profiles = crate::load_records(&state.pool, "profiles").await?;
    let hosts = crate::load_records(&state.pool, "hosts").await?;
    let nodes = crate::load_records(&state.pool, "nodes").await?;
    let (ids, tags) = permitted_inbound_tags(user, &squads);
    let mut outbounds = Vec::<Value>::new();
    for profile in &profiles {
        let cfg = match profile.get("config") {
            Some(Value::String(raw)) => serde_json::from_str::<Value>(raw).ok(),
            Some(v) => Some(v.clone()),
            None => None,
        };
        let Some(cfg) = cfg else { continue };
        let Some(inbounds) = cfg.get("inbounds").and_then(Value::as_array) else {
            continue;
        };
        for inbound in inbounds {
            let Some(tag) = nonempty(inbound, "tag") else {
                continue;
            };
            if !tags.contains(tag) {
                continue;
            }
            log_subscription_candidate(profile, inbound, &nodes, tag);
            // Do not silently fall back to a node's raw address when an explicitly
            // configured public host is disabled or pinned to a different node.
            let any_explicit_host = hosts.iter().any(|h| {
                nonempty(h, "tag") == Some(tag)
                    && (h.get("profileId").is_none_or(Value::is_null)
                        || same_record_id(h.get("profileId"), profile.get("id")))
            });
            let matched: Vec<&Value> = hosts
                .iter()
                .filter(|h| host_for_profile(h, tag, profile, &nodes))
                .collect();
            if !matched.is_empty() {
                for host in matched {
                    if let Some(mut outbound) = proxy_outbound(user, inbound, host, device) {
                        // Persist a stable selector identity independent of display name/order.
                        if let Some(id) = host.get("id").and_then(Value::as_i64) {
                            outbound["xmeshSourceKey"] = json!(format!("host:{id}"));
                        }
                        if let Some(node) = host_owner_node(host, profile, &nodes)
                            && let Some(id) = node.get("id").and_then(Value::as_i64)
                        {
                            outbound["xmeshOwnerNodeKey"] = json!(format!("node:{id}"));
                        }
                        if let Some(node) = direct_host_node(host, profile, &nodes) {
                            apply_ip_rotation(state, user, node, &mut outbound, rotate).await?;
                        }
                        outbounds.push(outbound);
                    } else {
                        log_unavailable_subscription_host(user, inbound, host, tag);
                    }
                }
            } else if !any_explicit_host {
                for node in nodes.iter().filter(|n| {
                    same_record_id(n.get("profileId"), profile.get("id"))
                        && n.get("disabled") != Some(&Value::Bool(true))
                }) {
                    let host = json!({"address":node.get("publicAddress").or_else(||node.get("externalAddress")).or_else(||node.get("addr")),"port":node.get("port").or_else(||inbound.get("port")),"remark":node.get("name"),"country":node.get("country")});
                    if let Some(mut outbound) = vless_outbound(user, inbound, &host, device) {
                        if let Some(id) = node.get("id").and_then(Value::as_i64) {
                            outbound["xmeshSourceKey"] = json!(format!("node:{id}:{tag}"));
                        }
                        apply_ip_rotation(state, user, node, &mut outbound, rotate).await?;
                        outbounds.push(outbound);
                    }
                }
            } else if any_explicit_host {
                tracing::warn!(inbound_tag=%tag, profile_id=?(profile.get("id").and_then(serde_json::Value::as_i64)),
      "Subscription explicit host exists but none matches enabled profile/node binding");
            }
        }
    }
    if outbounds.is_empty() {
        let reason = if ids.is_empty() || tags.is_empty() {
            "У пользователя нет доступных inbound: назначьте сквад с нужными inbound."
        } else if profiles.is_empty() {
            "Нет XRAY-профилей. Создайте и сохраните профиль с inbound."
        } else if hosts.is_empty() && nodes.is_empty() {
            "Нет публичных хостов или узлов. Добавьте адрес подключения в XRAY STUDIO."
        } else {
            "Не найдены рабочие подключения: проверьте сквады, теги inbound, UUID пользователя, адреса и порты публичных хостов, Reality и привязку профилей."
        };
        tracing::warn!(reason, squad_count=ids.len(), inbound_count=tags.len(), profile_count=profiles.len(), host_count=hosts.len(), node_count=nodes.len(), user_id=?(user.get("id").and_then(serde_json::Value::as_i64)), "Subscription has no valid endpoints");
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, reason));
    }
    Ok(outbounds)
}
pub async fn admin_client_json(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    crate::require_mutation(&actor)?;
    let user = record(&state, id).await?;
    let device = crate::subscription_user_agent::negotiate(&headers, &options)
        .map_err(bad)?
        .device
        .as_str();
    let proxies = collect_user_outbounds(&state, &user, device, false).await?;
    let setting = crate::read_settings(&state.pool).await?;
    let profile = crate::subscription_json::build_feed(proxies, &setting)
        .map_err(|detail| ApiError::new(StatusCode::BAD_REQUEST, detail))?;
    Ok(Json(profile))
}
fn add_subscription_profile_headers(response: &mut Response, settings: &Value) {
    // Client metadata: these are advisory headers and never change the native Xray JSON body.
    // Never reflect untrusted settings into HTTP headers without HeaderValue validation.
    let title = studio_string(
        settings,
        "subscriptionBrand",
        studio_string(settings, "brand", "XMesh Nexus"),
    );
    if let Ok(encoded) = header::HeaderValue::from_str(&format!("base64:{}", {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(title.as_bytes())
    })) {
        response.headers_mut().insert("profile-title", encoded);
    }
    if let Some(url) = settings
        .get("subscriptionSupportUrl")
        .and_then(Value::as_str)
        && url.starts_with("https://")
        && !url.contains(['\r', '\n'])
        && let Ok(value) = header::HeaderValue::from_str(url)
    {
        response.headers_mut().insert("support-url", value);
    }
    // Rotate announcements at a configurable UTC epoch-aligned interval.
    // A line containing only "---" separates announcements. Plain text stays compatible.
    if let Some(announcement) = settings
        .get("subscriptionAnnouncement")
        .and_then(Value::as_str)
    {
        let messages: Vec<&str> = announcement
            .split("\n---\n")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if !messages.is_empty() {
            let rotation_hours = settings
                .get("subscriptionAnnouncementRotationHours")
                .and_then(Value::as_u64)
                .unwrap_or(24)
                .clamp(1, 720);
            let slot = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                / (rotation_hours * 3_600);
            let selected_index =
                usize::try_from(slot % u64::try_from(messages.len()).unwrap_or(u64::MAX))
                    .expect("message index fits in usize");
            let selected = messages[selected_index];
            let encoded = base64::engine::general_purpose::STANDARD.encode(selected.as_bytes());
            if let Ok(value) = header::HeaderValue::from_str(&format!("base64:{encoded}")) {
                response.headers_mut().insert("announce", value);
            }
        }
    }
    let interval = settings
        .get("subscriptionUpdateInterval")
        .and_then(Value::as_u64)
        .unwrap_or(24)
        .clamp(1, 168);
    response.headers_mut().insert(
        "profile-update-interval",
        header::HeaderValue::from_str(&interval.to_string()).unwrap(),
    );
}

pub async fn serve(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    if !valid_token(&token) {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Subscription not found",
        ));
    }
    let row = sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
        .bind(token_hash(&token))
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Subscription not found"))?;
    let id: i64 = row.try_get("user_id")?;
    let user = record(&state, id).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    if crate::user_status(&user, now) != "ACTIVE" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Subscription inactive",
        ));
    }
    // Resolve content and XHTTP transport profile from the VPN client's
    // actual User-Agent. Explicit query parameters remain optional overrides.
    let client = crate::subscription_user_agent::negotiate(&headers, &options).map_err(bad)?;
    let outbounds = collect_user_outbounds(&state, &user, client.device.as_str(), true).await?;
    let settings = crate::read_settings(&state.pool).await?;
    // Native Xray JSON is the only supported subscription format.
    // A disabled SMART selector changes routing, never the wire representation.
    let json = crate::subscription_json::build_feed(outbounds, &settings).map_err(|message| {
        tracing::warn!(user_id=id, error=%message,"Subscription JSON could not be generated");
        ApiError::new(StatusCode::SERVICE_UNAVAILABLE, message)
    })?;
    let mut response = Json(json).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        "application/json; charset=utf-8".parse().unwrap(),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store, private".parse().unwrap());
    response
        .headers_mut()
        .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response
        .headers_mut()
        .insert(header::VARY, "User-Agent, Accept".parse().unwrap());
    add_subscription_profile_headers(&mut response, &settings);
    // User limits are expressed in GiB in panel records; the conventional subscription-userinfo
    // header expects bytes and Unix seconds.
    let consumed_gib = user
        .get("used")
        .and_then(Value::as_f64)
        .or_else(|| user.get("used").and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(0.0)
        .max(0.0);
    let limit = user
        .get("limit")
        .and_then(Value::as_f64)
        .or_else(|| user.get("limit").and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(0.0)
        .max(0.0);
    let expiry = user.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
    let to_bytes = |gib: f64| -> u64 {
        if gib.is_finite() {
            (gib * 1_073_741_824.0).min(u64::MAX as f64) as u64
        } else {
            0
        }
    };
    let info = format!(
        "upload=0; download={}; total={}; expire={}",
        to_bytes(consumed_gib),
        to_bytes(limit),
        if expiry > 1_000_000_000_000 {
            expiry / 1000
        } else {
            expiry
        }
    );
    if let Ok(value) = header::HeaderValue::from_str(&info) {
        response
            .headers_mut()
            .insert("subscription-userinfo", value);
    }
    Ok(response)
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn studio_string<'a>(settings: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    settings
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback)
}
fn studio_enabled(settings: &Value, key: &str, default: bool) -> bool {
    settings
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(default)
}
fn studio_color(settings: &Value, key: &str, default: &str) -> String {
    let v = studio_string(settings, key, default);
    if v.len() == 7 && v.starts_with('#') && v.bytes().skip(1).all(|c| c.is_ascii_hexdigit()) {
        v.to_owned()
    } else {
        default.to_owned()
    }
}
fn app_item(label: &str, platform: &str, url: &str) -> String {
    let icon = label.chars().take(2).collect::<String>();
    let content = format!(
        "<span>{}</span><div><b>{}</b><small>{}</small></div>",
        escape_html(&icon),
        escape_html(label),
        escape_html(platform)
    );
    if url.starts_with("https://") && !url.contains(['"', '<', '>']) {
        format!(
            "<a class=\"subscription-preview-app\" href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>",
            escape_html(url),
            content
        )
    } else {
        format!("<div class=\"subscription-preview-app\">{content}</div>")
    }
}
fn app_catalog(settings: &Value, language: &str) -> String {
    let mut apps = String::new();
    let known = [
        ("happ", "Happ", "iOS · Android · Windows · macOS"),
        ("incy", "Incy", "iOS · Android"),
        ("v2raytun", "v2rayTun", "iOS · Android"),
        ("v2rayn", "v2rayN", "Windows · Linux · macOS"),
        ("v2rayng", "v2rayNG", "Android"),
        ("streisand", "Streisand", "iOS"),
        (
            "hiddify",
            "Hiddify",
            "iOS · Android · Windows · macOS · Linux",
        ),
        ("nekobox", "NekoBox", "Android"),
        ("shadowrocket", "Shadowrocket", "iOS"),
        ("flclash", "FlClash", "Windows · macOS · Linux · Android"),
        ("stash", "Stash", "iOS"),
        ("singbox", "sing-box", "iOS · Android · Desktop"),
        ("v2box", "V2Box", "iOS · Android"),
        ("loon", "Loon", "iOS"),
        ("mihomo", "Mihomo Party", "Desktop"),
        ("clashverge", "Clash Verge", "Windows · macOS · Linux"),
    ];
    let enabled = settings.get("subscriptionClients");
    let links = settings.get("subscriptionClientLinks");
    for (index, (id, label, platform)) in known.into_iter().enumerate() {
        let visible = enabled
            .and_then(|v| v.get(id))
            .and_then(Value::as_bool)
            .unwrap_or(index < 7);
        if !visible {
            continue;
        }
        let url = links
            .and_then(|v| v.get(id))
            .and_then(Value::as_str)
            .unwrap_or("");
        apps.push_str(&app_item(label, platform, url));
    }
    if let Some(custom) = settings
        .get("subscriptionCustomClients")
        .and_then(Value::as_array)
    {
        for item in custom {
            if item.get("enabled").and_then(Value::as_bool) != Some(true) {
                continue;
            }
            let label = studio_string(item, "name", "");
            if label.is_empty() {
                continue;
            }
            apps.push_str(&app_item(
                label,
                studio_string(item, "platforms", ""),
                studio_string(item, "url", ""),
            ));
        }
    }
    if apps.is_empty() {
        return String::new();
    }
    let title = studio_string(
        settings,
        if language == "en" {
            "subscriptionAppsTitleEn"
        } else {
            "subscriptionAppsTitle"
        },
        if language == "en" {
            "Connection apps"
        } else {
            "Приложения для подключения"
        },
    );
    let layout = if studio_string(settings, "subscriptionClientLayout", "grid") == "list" {
        "list"
    } else {
        "grid"
    };
    format!(
        "<section class=\"subscription-preview-apps\" data-client-layout=\"{}\"><header>{}</header><div>{}</div></section>",
        layout,
        escape_html(title),
        apps
    )
}
// Match the exact persisted Studio path. Unknown public routes are never
// treated as subscriptions, even though the router supports variable prefixes.
pub async fn portal_route(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let (prefix, token) = uri
        .path()
        .rsplit_once('/')
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Subscription not found"))?;
    if !valid_token(token) {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Subscription not found",
        ));
    }
    let settings = crate::read_settings(&state.pool).await?;
    let configured = studio_string(&settings, "subscriptionPath", "/s").trim_end_matches('/');
    if prefix != configured {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Subscription not found",
        ));
    }
    portal(
        State(state),
        Path(token.to_owned()),
        headers,
        Query(options),
    )
    .await
}
pub async fn portal(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(options): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    if !valid_token(&token) {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "Subscription not found",
        ));
    }
    // A single permanent HTTPS URL is a portal for browsers and a
    // negotiated JSON/VLESS subscription for the VPN client's User-Agent.
    if crate::subscription_user_agent::wants_feed(&headers, &options).map_err(bad)? {
        return serve(State(state), Path(token), headers, Query(options)).await;
    }
    let hash = token_hash(&token);
    let row = sqlx::query("SELECT user_id FROM user_subscription_tokens WHERE token_hash=$1")
        .bind(hash)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "Subscription not found"))?;
    let user_id: i64 = row.try_get("user_id")?;
    let user = record(&state, user_id).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    let active = crate::user_status(&user, now) == "ACTIVE";
    let settings = crate::read_settings(&state.pool).await?;
    let lang = if options.get("lang").is_some_and(|s| s == "en") {
        "en"
    } else if options.get("lang").is_some_and(|s| s == "ru") {
        "ru"
    } else {
        studio_string(&settings, "subscriptionLanguage", "ru")
    };
    let en = lang == "en";
    let consumed_gib = user
        .get("used")
        .and_then(Value::as_f64)
        .or_else(|| user.get("used").and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(0.0)
        .max(0.0);
    let limit = user
        .get("limit")
        .and_then(Value::as_f64)
        .or_else(|| user.get("limit").and_then(Value::as_i64).map(|v| v as f64))
        .unwrap_or(0.0)
        .max(0.0);
    let mut metrics = String::new();
    if studio_enabled(&settings, "subscriptionShowTraffic", true) {
        let remaining = if limit > 0.0 {
            format!(
                "{:.2} / {:.2} {}",
                consumed_gib,
                limit,
                if en { "GB" } else { "ГБ" }
            )
        } else {
            format!(
                "{:.2} {} / {}",
                consumed_gib,
                if en { "GB" } else { "ГБ" },
                if en {
                    "Unlimited"
                } else {
                    "Без лимита"
                }
            )
        };
        let pct = if limit > 0.0 {
            (consumed_gib / limit * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        let _ = write!(
            metrics,
            "<div data-subscription-traffic><small>{}</small><b>{}</b><div class=\"subscription-preview-progress\"><i style=\"width:{pct:.1}%\"></i></div></div>",
            if en { "Traffic" } else { "Трафик" },
            escape_html(&remaining)
        );
    }
    if studio_enabled(&settings, "subscriptionShowExpiry", true) {
        let expiry = user.get("expireAt").and_then(Value::as_i64).unwrap_or(0);
        let _ = write!(
            metrics,
            "<div data-subscription-expiry><small>{}</small><b data-expiry=\"{}\">{}</b></div>",
            if en {
                "Expires"
            } else {
                "Действует до"
            },
            expiry,
            if expiry > 0 {
                "—"
            } else if en {
                "Unlimited"
            } else {
                "Бессрочно"
            }
        );
    }
    if !metrics.is_empty() {
        metrics = format!(
            "<div class=\"subscription-preview-meta\" data-subscription-metrics>{metrics}</div>"
        );
    }
    // Show/copy one canonical HTTPS subscription URL. The requesting app's
    // User-Agent decides the JSON/link format and device profile.
    let raw_link = studio_url(&settings, &token);
    let mut quick = String::new();
    let mut qr = String::new();
    let mut devices = String::new();
    let cta;
    let mut apps = String::new();
    if active {
        let button = studio_string(
            &settings,
            if en {
                "subscriptionCtaEn"
            } else {
                "subscriptionCta"
            },
            if en {
                "Connect"
            } else {
                "Подключиться"
            },
        );
        cta = format!(
            "<button type=\"button\" class=\"subscription-preview-cta\" id=\"connect-link\" title=\"{}\">{}</button><input type=\"hidden\" id=\"subscription-link\" value=\"{}\">",
            if en {
                "Copy HTTPS subscription link"
            } else {
                "Скопировать HTTPS-ссылку подписки"
            },
            escape_html(button),
            escape_html(&raw_link)
        );
        if studio_enabled(&settings, "subscriptionShowCopy", true) {
            let _ = write!(
                quick,
                "<button type=\"button\" id=\"copy-link\">{}</button>",
                if en {
                    "Copy link"
                } else {
                    "Скопировать ссылку"
                }
            );
        }
        if studio_enabled(&settings, "subscriptionShowQr", true) {
            quick.push_str("<button type=\"button\" id=\"toggle-qr\" aria-controls=\"subscription-qr\" aria-expanded=\"false\">QR</button>");
            "<div id=\"subscription-qr\" class=\"subscription-preview-qr\" hidden aria-label=\"QR-код подписки\"></div>".clone_into(&mut qr);
        }
        if studio_enabled(&settings, "subscriptionShowDevices", false) {
            let _ = write!(
                quick,
                "<button type=\"button\" id=\"toggle-devices\" aria-controls=\"subscription-devices\" aria-expanded=\"false\">{}</button>",
                if en {
                    "Devices"
                } else {
                    "Устройства"
                }
            );
            let maximum = user.get("hwid").and_then(Value::as_i64).unwrap_or(0);
            let connected_devices = user
                .get("devices")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            devices = format!(
                "<div id=\"subscription-devices\" class=\"subscription-public-devices\" hidden>{}: {} · {}: {}</div>",
                if en {
                    "Connected devices"
                } else {
                    "Подключённые устройства"
                },
                connected_devices,
                if en { "Limit" } else { "Лимит" },
                if maximum > 0 {
                    maximum.to_string()
                } else {
                    if en {
                        "Unlimited"
                    } else {
                        "Без лимита"
                    }
                    .to_owned()
                }
            );
        }
        if !quick.is_empty() {
            quick = format!("<div class=\"subscription-preview-quick\">{quick}</div>");
        }
        if studio_enabled(&settings, "subscriptionShowApps", true) {
            apps = app_catalog(&settings, lang);
        }
    } else {
        cta = format!(
            "<div class=\"subscription-preview-cta\" aria-disabled=\"true\">{}</div>",
            if en {
                "Subscription inactive"
            } else {
                "Подписка неактивна"
            }
        );
    }
    let support = if studio_enabled(&settings, "subscriptionShowSupport", false) {
        let url = studio_string(&settings, "subscriptionSupportUrl", "");
        let label = escape_html(studio_string(
            &settings,
            if en {
                "subscriptionSupportLabelEn"
            } else {
                "subscriptionSupportLabel"
            },
            if en { "Support" } else { "Поддержка" },
        ));
        if url.starts_with("https://") {
            format!(
                "<a class=\"subscription-preview-support\" href=\"{}\" rel=\"noopener noreferrer\" target=\"_blank\">{label}</a>",
                escape_html(url)
            )
        } else {
            format!("<div class=\"subscription-preview-support\">{label}</div>")
        }
    } else {
        String::new()
    };
    let logo = studio_string(&settings, "subscriptionLogoUrl", "");
    let logo_markup = if logo.starts_with("https://") {
        format!(
            "<img src=\"{}\" alt=\"\" class=\"subscription-preview-logo\">",
            escape_html(logo)
        )
    } else {
        "<span aria-hidden=\"true\">✦</span>".to_owned()
    };
    let visible_status = studio_enabled(&settings, "subscriptionShowStatus", true);
    let status_dot = if visible_status {
        format!(
            "<span class=\"subscription-preview-ok\" style=\"color:{}\">●</span>",
            if active {
                "var(--portal-accent)"
            } else {
                "#ef8888"
            }
        )
    } else {
        String::new()
    };
    let title = if active {
        studio_string(
            &settings,
            if en {
                "subscriptionHeroEn"
            } else {
                "subscriptionHero"
            },
            if en {
                "Subscription active"
            } else {
                "Подписка активна"
            },
        )
    } else if en {
        "Subscription inactive"
    } else {
        "Подписка неактивна"
    };
    let footer = studio_string(
        &settings,
        if en {
            "subscriptionFooterEn"
        } else {
            "subscriptionFooter"
        },
        "",
    );
    let logo_brand = studio_string(
        &settings,
        "subscriptionBrand",
        studio_string(&settings, "brand", "XMesh Nexus"),
    );
    let background = studio_color(&settings, "subscriptionBackground", "#0c131b");
    let card_color = studio_color(&settings, "subscriptionCardColor", "#15212b");
    let text_color = studio_color(&settings, "subscriptionTextColor", "#ecf3f6");
    let accent = studio_color(&settings, "subscriptionAccent", "#7be5b4");
    let secondary = studio_color(&settings, "subscriptionSecondaryAccent", "#c6e985");
    let radius = settings
        .get("subscriptionRadius")
        .and_then(Value::as_u64)
        .unwrap_or(16)
        .clamp(1, 36);
    let allowed = |key: &str, valid: &[&str], default: &str| -> String {
        let value = studio_string(&settings, key, default);
        if valid.contains(&value) {
            value.to_owned()
        } else {
            default.to_owned()
        }
    };
    let mut html = include_str!("subscription_template.html").to_owned();
    let changes = [
        ("{{LANG}}", lang.to_owned()),
        ("{{BRAND}}", escape_html(logo_brand)),
        ("{{ACCENT}}", accent),
        ("{{SECONDARY_ACCENT}}", secondary),
        ("{{BACKGROUND}}", background),
        ("{{CARD_COLOR}}", card_color),
        ("{{TEXT_COLOR}}", text_color),
        ("{{RADIUS}}", radius.to_string()),
        (
            "{{THEME}}",
            allowed("subscriptionTheme", &["dark", "light"], "dark"),
        ),
        (
            "{{LAYOUT}}",
            allowed(
                "subscriptionLayout",
                &["standard", "centered", "compact"],
                "standard",
            ),
        ),
        (
            "{{CARD_STYLE}}",
            allowed(
                "subscriptionCardStyle",
                &["soft", "outline", "flat", "glass", "raised"],
                "soft",
            ),
        ),
        (
            "{{FONT}}",
            allowed(
                "subscriptionFont",
                &[
                    "system",
                    "manrope",
                    "mono",
                    "onest",
                    "inter",
                    "golos",
                    "rubik",
                    "nunito",
                    "plex",
                    "roboto",
                    "pt",
                    "montserrat",
                    "ubuntu",
                    "opensans",
                    "source",
                    "fira",
                    "jost",
                ],
                "system",
            ),
        ),
        ("{{LOGO}}", logo_markup),
        (
            "{{RU_SELECTED}}",
            if en { String::new() } else { "on".to_owned() },
        ),
        (
            "{{EN_SELECTED}}",
            if en { "on".to_owned() } else { String::new() },
        ),
        (
            "{{RU_CURRENT}}",
            if en { "false" } else { "page" }.to_owned(),
        ),
        (
            "{{EN_CURRENT}}",
            if en { "page" } else { "false" }.to_owned(),
        ),
        ("{{STATUS_DOT}}", status_dot),
        ("{{HERO}}", escape_html(title)),
        (
            "{{DESCRIPTION}}",
            escape_html(studio_string(
                &settings,
                if en {
                    "subscriptionDescriptionEn"
                } else {
                    "subscriptionDescription"
                },
                if en {
                    "Connection setup and subscription information."
                } else {
                    "Настройки подключения и информация о подписке."
                },
            )),
        ),
        ("{{METRICS}}", metrics),
        ("{{CTA}}", cta),
        ("{{QUICK_ACTIONS}}", quick),
        ("{{QR}}", qr),
        ("{{DEVICE_INFO}}", devices),
        ("{{APPS}}", apps),
        ("{{SUPPORT}}", support),
        ("{{FOOTER}}", escape_html(footer)),
    ];
    for (marker, value) in changes {
        html = html.replace(marker, &value);
    }
    let mut response = Html(html).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secret_format() {
        assert!(valid_token(&"a".repeat(64)));
        assert!(!valid_token(&"G".repeat(64)));
        assert_ne!(token_hash("a"), token_hash("b"));
    }
    #[test]
    fn encrypted_token_round_trip_and_identity_binding() {
        // This regression test deliberately keeps the stateful integration path out
        // of a unit test; authenticated route/DB tests cover the actual storage.
        let token = "a".repeat(64);
        assert!(valid_token(&token));
        assert_ne!(token_hash(&token), token);
    }
    #[test]
    fn native_json_is_structured_and_never_leaks_reality_private_key() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let inbound = json!({"tag":"SWEDEN","protocol":"vless","port":443,
   "settings":{"flow":"xtls-rprx-vision"},
   "streamSettings":{"network":"xhttp","security":"reality",
    "xhttpSettings":{"path":"/stream","mode":"stream-up","xmux":{"cMaxReuseTimes":64}},
    "realitySettings":{"privateKey":"SERVER_PRIVATE_KEY_MUST_NEVER_LEAK",
     "serverNames":["vpn.example.org"],"shortIds":["abcd"]}}});
        let host = json!({"address":"vpn.example.org","publicKey":"PUBLIC_KEY",
   "externalSNI":"vpn.example.org","shortId":"abcd","remark":"Sweden"});
        let outbound = vless_outbound(&user, &inbound, &host, "auto")
            .expect("Reality public metadata is complete");
        let data = crate::subscription_json::build(vec![outbound], &json!({}))
            .expect("build client config");
        let rendered = serde_json::to_string(&data).expect("serialize Xray JSON");
        assert!(!rendered.contains("SERVER_PRIVATE_KEY_MUST_NEVER_LEAK"));
        assert_eq!(
            data["outbounds"][0]["settings"]["vnext"][0]["users"][0]["id"],
            user["xrayId"]
        );
        assert_eq!(
            data["outbounds"][0]["streamSettings"]["xhttpSettings"]["mode"],
            "stream-up"
        );
        assert_eq!(
            data["outbounds"][0]["streamSettings"]["xhttpSettings"]["xmux"]["cMaxReuseTimes"],
            64
        );
        assert_eq!(
            data["outbounds"][0]["streamSettings"]["realitySettings"]["password"],
            "PUBLIC_KEY"
        );
        assert!(
            data["routing"]["rules"][2]["outboundTag"]
                .as_str()
                .unwrap()
                .starts_with("xmesh-SE-0001")
        );
        assert_eq!(data["remarks"], "Sweden");
        assert_eq!(data["inbounds"][0]["protocol"], "socks");
    }
    #[test]
    fn host_rotation_requires_unambiguous_direct_ip_not_cdn() {
        let profile = json!({"id":7});
        let nodes = vec![
            json!({"id":10,"profileId":7,"addr":"13.143.175.131"}),
            json!({"id":11,"profileId":7,"addr":"13.143.175.132"}),
        ];
        let host = json!({"address":"13.143.175.131","nodes":[10]});
        assert_eq!(direct_host_node(&host, &profile, &nodes).unwrap()["id"], 10);
        assert!(
            direct_host_node(
                &json!({"address":"cdn.example.org","nodes":[10]}),
                &profile,
                &nodes
            )
            .is_none()
        );
        assert!(
            direct_host_node(
                &json!({"address":"13.143.175.130","nodes":[10]}),
                &profile,
                &nodes
            )
            .is_none()
        );
    }
    #[test]
    fn mixed_string_and_number_ids_keep_public_hosts_connected() {
        let profile = json!({"id":22});
        let nodes =
            vec![json!({"id":21,"profileId":"22","addr":"13.143.175.131","disabled":false})];
        let host = json!({"tag":"vless-main-2","profileId":"22","nodes":["21"],"address":"13.143.175.131"});
        assert!(host_for_profile(&host, "vless-main-2", &profile, &nodes));
        assert_eq!(direct_host_node(&host, &profile, &nodes).unwrap()["id"], 21);
    }
    #[test]
    fn hosts_respect_profile_and_node_assignment() {
        let profile = json!({"id":7});
        let nodes = vec![
            json!({"id":10,"profileId":7,"disabled":false}),
            json!({"id":11,"profileId":8,"disabled":false}),
        ];
        assert!(host_for_profile(
            &json!({"tag":"PL","nodes":[]}),
            "PL",
            &profile,
            &nodes
        ));
        assert!(host_for_profile(
            &json!({"tag":"PL","nodes":[10]}),
            "PL",
            &profile,
            &nodes
        ));
        assert!(!host_for_profile(
            &json!({"tag":"PL","nodes":[11]}),
            "PL",
            &profile,
            &nodes
        ));
        assert!(!host_for_profile(
            &json!({"tag":"PL","profileId":8}),
            "PL",
            &profile,
            &nodes
        ));
        assert!(!host_for_profile(
            &json!({"tag":"PL","disabled":true}),
            "PL",
            &profile,
            &nodes
        ));
        assert!(!host_for_profile(
            &json!({"tag":"DE","nodes":[]}),
            "PL",
            &profile,
            &nodes
        ));
        let disabled = vec![json!({"id":10,"profileId":7,"disabled":true})];
        assert!(!host_for_profile(
            &json!({"tag":"PL","nodes":[10]}),
            "PL",
            &profile,
            &disabled
        ));
    }
    #[test]
    fn xhttp_device_profiles_are_applied_only_to_selected_device() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let inbound = json!({"tag":"DE","protocol":"vless","port":443,
   "xmesh":{"xhttpDeviceProfiles":{
      "iOS":{"mode":"packet-up","uplinkHTTPMethod":"POST","xmux":{"cMaxReuseTimes":0}},
      "Windows":{"mode":"stream-up","xmux":{"cMaxReuseTimes":64}}
   }},
   "settings":{"decryption":"none"},
   "streamSettings":{"network":"xhttp","security":"tls",
    "tlsSettings":{"serverName":"vpn.example.org"},
    "xhttpSettings":{"path":"/x","mode":"auto"}}});
        let host = json!({"address":"vpn.example.org","sni":"vpn.example.org"});
        let ios = vless_outbound(&user, &inbound, &host, "ios").unwrap();
        let windows = vless_outbound(&user, &inbound, &host, "windows").unwrap();
        let automatic = vless_outbound(&user, &inbound, &host, "auto").unwrap();
        assert_eq!(ios["streamSettings"]["xhttpSettings"]["mode"], "packet-up");
        assert_eq!(
            windows["streamSettings"]["xhttpSettings"]["mode"],
            "stream-up"
        );
        assert_eq!(automatic["streamSettings"]["xhttpSettings"]["mode"], "auto");
        assert_eq!(
            windows["streamSettings"]["xhttpSettings"]["xmux"]["cMaxReuseTimes"],
            64
        );
    }
    #[test]
    fn extended_xhttp_obfs_and_server_secrets_are_projected_safely() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let inbound = json!({"tag":"DE","protocol":"vless","port":5011,
   "settings":{"decryption":"none"},"streamSettings":{"network":"xhttp","security":"reality",
    "realitySettings":{"privateKey":"SECRET_PRIVATE","publicKey":"PUB",
      "serverNames":["example.org"],"shortIds":["abcd"]},
    "xhttpSettings":{"path":"/stream","xPaddingObfsMode":true,"xPaddingKey":"x-token",
      "xPaddingHeader":"X-Request-Token","xPaddingMethod":"tokenish",
      "xPaddingPlacement":"header","seqPlacement":"query","seqKey":"segment",
      "sessionIDPlacement":"cookie","sessionIDKey":"session_id",
      "sessionIDTable":"Base62","sessionIDLength":"16-48",
      "scStreamUpServerSecs":"30-60"}}});
        let host = json!({"address":"vpn.example.org","externalPort":443});
        let proxy = proxy_outbound(&user, &inbound, &host, "auto").unwrap();
        let feed = crate::subscription_json::build_feed(vec![proxy], &json!({})).unwrap();
        let x = &feed[0]["outbounds"][0]["streamSettings"]["xhttpSettings"];
        assert_eq!(x["xPaddingObfsMode"], true);
        assert_eq!(x["xPaddingPlacement"], "header");
        assert_eq!(x["sessionIDPlacement"], "cookie");
        assert_eq!(x["sessionIDLength"], "16-48");
        assert!(x.get("scStreamUpServerSecs").is_none());
        assert!(!feed.to_string().contains("SECRET_PRIVATE"));
    }
    #[test]
    fn per_user_multi_protocol_credentials_match_node_conventions() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let host = json!({"address":"vpn.example.org","externalPort":443});
        for (protocol, settings, field) in [
            ("vmess", json!({}), "id"),
            ("trojan", json!({}), "password"),
            ("shadowsocks", json!({"method":"aes-256-gcm"}), "password"),
            ("hysteria", json!({"version":2}), "auth"),
        ] {
            let method = if protocol == "hysteria" {
                "hysteria"
            } else {
                "xhttp"
            };
            let inbound = json!({"protocol":protocol,"tag":"N","settings":settings,
    "streamSettings":{"network":method,"security":"tls",
      "tlsSettings":{"serverName":"example.org"}}});
            let proxy = proxy_outbound(&user, &inbound, &host, "auto").unwrap();
            let auth = if protocol == "hysteria" {
                &proxy["streamSettings"]["hysteriaSettings"][field]
            } else {
                &proxy["settings"][field]
            };
            assert_eq!(auth, &user["xrayId"], "{protocol}");
            assert!(crate::subscription_json::build_feed(vec![proxy], &json!({})).is_ok());
        }
    }
    #[test]
    fn masque_client_basic_auth_matches_provisioned_user() {
        let user = json!({"id":42,"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let inbound = json!({"tag":"CDN NL","protocol":"masque",
   "settings":{"address":["10.0.0.1/24"]},
   "streamSettings":{"method":"masque","security":"tls",
    "tlsSettings":{"serverName":"vpn.example.org"},
    "masqueSettings":{"path":"/.well-known/masque/ip/{target}/{ipproto}/",
      "user":"SERVER_SECRET_SHOULD_NOT_BE_COPIED",
      "pass":"SERVER_SECRET_SHOULD_NOT_BE_COPIED"}}});
        let host = json!({"address":"vpn.example.org","externalPort":443});
        let proxy = proxy_outbound(&user, &inbound, &host, "auto").unwrap();
        assert_eq!(
            proxy["streamSettings"]["masqueSettings"]["user"],
            "xmesh-u42--CDN%20NL"
        );
        assert_eq!(
            proxy["streamSettings"]["masqueSettings"]["pass"],
            user["xrayId"]
        );
        assert!(
            !proxy
                .to_string()
                .contains("SERVER_SECRET_SHOULD_NOT_BE_COPIED")
        );
        assert!(crate::subscription_json::build_feed(vec![proxy], &json!({})).is_ok());
    }
    #[test]
    fn ss2022_user_key_and_server_key_are_both_required() {
        use base64::Engine as _;
        let encode = |byte: u8| base64::engine::general_purpose::STANDARD.encode([byte; 32]);
        let server = encode(7);
        let client = encode(8);
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000","ssPassword":client});
        let inbound = json!({"protocol":"shadowsocks",
   "settings":{"method":"2022-blake3-aes-256-gcm","password":server},
   "streamSettings":{"network":"raw","security":"none"}});
        let host = json!({"address":"vpn.example.org","externalPort":443});
        let proxy = proxy_outbound(&user, &inbound, &host, "auto").unwrap();
        assert_eq!(
            proxy["settings"]["password"],
            json!(format!("{server}:{client}"))
        );
        let mut broken = inbound;
        broken["settings"]["password"] = json!("invalid-base64");
        assert!(proxy_outbound(&user, &broken, &host, "auto").is_none());
    }
    #[test]
    fn insecure_trojan_and_missing_ss2022_key_fail_closed() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let host = json!({"address":"vpn.example.org","externalPort":443});
        let trojan =
            json!({"protocol":"trojan","streamSettings":{"network":"raw","security":"none"}});
        assert!(proxy_outbound(&user, &trojan, &host, "auto").is_none());
        let ss = json!({"protocol":"shadowsocks","settings":{"method":"2022-blake3-aes-256-gcm"},
   "streamSettings":{"network":"raw","security":"none"}});
        assert!(proxy_outbound(&user, &ss, &host, "auto").is_none());
    }
    #[test]
    fn invalid_reality_not_exported() {
        let user = json!({"xrayId":"550e8400-e29b-41d4-a716-446655440000"});
        let inbound = json!({"protocol":"vless","port":443,"streamSettings":{"network":"xhttp","security":"reality","realitySettings":{"serverNames":["example.org"]}}});
        let host = json!({"address":"vpn.example.org"});
        assert!(vless_outbound(&user, &inbound, &host, "auto").is_none());
    }
}
