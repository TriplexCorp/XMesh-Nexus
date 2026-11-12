//! Bounded Redis-side flood protection for public subscription bearer URLs.
//! No request IP, raw URI, User-Agent, or bearer token is logged or persisted.
//! The XMesh Sub edge, not Nexus, is responsible for unforgeable peer-IP limits.
use crate::{ApiError, AppState, auth};
use axum::{
    Json,
    extract::{Extension, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const CONFIG_CACHE: &str = "xmesh:subscription:flood:config";
const CACHE_SECONDS: u64 = 10;
// Bound untrusted random bearer-token cardinality in Redis. Beyond this
// threshold skip per-token keys (but still monitor) to preserve availability.
const MAX_TOKEN_BUCKETS_PER_MINUTE: u64 = 20_000;
const LUA: &str = r#"
local total = redis.call('INCR',KEYS[1])
if total == 1 then redis.call('EXPIRE',KEYS[1],75) end
redis.call('HINCRBY',KEYS[3],'requests',1)
if total == 1 then redis.call('EXPIRE',KEYS[3],180) end
local over = 0
if total > tonumber(ARGV[2]) then
  redis.call('HINCRBY',KEYS[3],'globalGuard',1)
  if ARGV[3] == 'protect' then
    redis.call('HINCRBY',KEYS[3],'blocked',1)
    return 1
  end
else
  local count = redis.call('INCR',KEYS[2])
  if count == 1 then redis.call('EXPIRE',KEYS[2],75) end
  if count > tonumber(ARGV[1]) then
    over = 1
    redis.call('HINCRBY',KEYS[3],'exceeded',1)
    if ARGV[3] == 'protect' then
      redis.call('HINCRBY',KEYS[3],'blocked',1)
    end
  end
end
return over
"#;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct FloodConfig {
    pub enabled: bool,
    pub mode: String,
    pub ip_per_minute: u64,
    pub token_per_minute: u64,
}
impl Default for FloodConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: "monitor".to_owned(),
            ip_per_minute: 120,
            token_per_minute: 12,
        }
    }
}
impl FloodConfig {
    pub fn validate(&self) -> Result<(), ApiError> {
        if !matches!(self.mode.as_str(), "monitor" | "protect")
            || !(30..=600).contains(&self.ip_per_minute)
            || self.ip_per_minute % 30 != 0
            || !(3..=60).contains(&self.token_per_minute)
            || self.token_per_minute % 3 != 0
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Некорректные лимиты защиты подписок.",
            ));
        }
        Ok(())
    }
}
pub fn validate_settings(value: &Value) -> Result<(), ApiError> {
    let parsed = serde_json::from_value::<FloodConfig>(value.clone()).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Некорректная конфигурация защиты подписок.",
        )
    })?;
    parsed.validate()
}
pub async fn current(state: &AppState) -> FloodConfig {
    let mut conn = state.redis.clone();
    match redis::cmd("GET")
        .arg(CONFIG_CACHE)
        .query_async::<Option<String>>(&mut conn)
        .await
    {
        Ok(Some(saved)) => {
            if let Ok(config) = serde_json::from_str::<FloodConfig>(&saved) {
                if config.validate().is_ok() {
                    return config;
                }
            }
        }
        Ok(None) => {}
        Err(_) => return FloodConfig::default(), // fail open without DB stampede
    }
    let setting = crate::read_settings(&state.pool)
        .await
        .ok()
        .and_then(|s| s.get("subscriptionFlood").cloned());
    let config = setting
        .and_then(|v| serde_json::from_value::<FloodConfig>(v).ok())
        .filter(|c| c.validate().is_ok())
        .unwrap_or_default();
    // Short TTL avoids stale protection settings after an API restart or patch.
    let _ = redis::cmd("SETEX")
        .arg(CONFIG_CACHE)
        .arg(CACHE_SECONDS)
        .arg(serde_json::to_string(&config).unwrap_or_default())
        .query_async::<String>(&mut conn)
        .await;
    config
}
fn minute() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 60
}
fn token_digest(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}
pub async fn enforce(state: &AppState, token: &str) -> Option<Response> {
    // Other malformed tokens will still receive the usual 404 from the
    // subscription handler, with no Redis key allocated.
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let config = current(state).await;
    if !config.enabled {
        return None;
    }
    let interval = minute();
    let mut conn = state.redis.clone();
    let verdict: redis::RedisResult<i64> = redis::cmd("EVAL")
        .arg(LUA)
        .arg(3)
        .arg(format!("xmesh:subscription:flood:global:{interval}"))
        .arg(format!(
            "xmesh:subscription:flood:token:{interval}:{}",
            token_digest(token)
        ))
        .arg(format!("xmesh:subscription:flood:stats:{interval}"))
        .arg(config.token_per_minute.saturating_add(10))
        .arg(MAX_TOKEN_BUCKETS_PER_MINUTE)
        .arg(&config.mode)
        .query_async(&mut conn)
        .await;
    // Fail open for availability if Redis cannot be reached; never cache or
    // propagate the bearer token via diagnostics.
    if matches!(verdict, Ok(1)) && config.mode == "protect" {
        let mut response = (
            StatusCode::TOO_MANY_REQUESTS,
            "Too many subscription refreshes. Try again shortly.",
        )
            .into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        );
        return Some(response);
    }
    None
}
pub async fn status(
    State(state): State<AppState>,
    Extension(actor): Extension<auth::AuthUser>,
) -> Result<Json<Value>, ApiError> {
    crate::require_owner(&actor)?;
    let config = current(&state).await;
    let mut conn = state.redis.clone();
    let mut totals = [0u64; 4];
    for interval in [minute().saturating_sub(1), minute()] {
        let fields: Vec<Option<u64>> = redis::cmd("HMGET")
            .arg(format!("xmesh:subscription:flood:stats:{interval}"))
            .arg("requests")
            .arg("exceeded")
            .arg("blocked")
            .arg("globalGuard")
            .query_async(&mut conn)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Статистика защиты временно недоступна.",
                )
            })?;
        for (slot, item) in totals.iter_mut().zip(fields) {
            *slot = slot.saturating_add(item.unwrap_or(0));
        }
    }
    Ok(Json(json!({"config":config, "windowMinutes":2,
        "requests":totals[0],"exceeded":totals[1],
        "blocked":totals[2],"globalGuard":totals[3],
        "ipLayer":"edge-required"})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_monitor_to_preserve_existing_clients() {
        let config = FloodConfig::default();
        assert!(config.enabled);
        assert_eq!(config.mode, "monitor");
        assert!(config.validate().is_ok());
        assert!(
            validate_settings(&json!({"enabled":true,"mode":"protect",
            "ipPerMinute":120,"tokenPerMinute":12}))
            .is_ok()
        );
        assert!(
            validate_settings(&json!({"mode":"block","ipPerMinute":120,
            "tokenPerMinute":12}))
            .is_err()
        );
        assert!(
            validate_settings(&json!({"mode":"protect","ipPerMinute":0,
            "tokenPerMinute":12}))
            .is_err()
        );
        assert!(validate_settings(&json!({"mode":"monitor","extra":"unsafe"})).is_err());
    }
    #[test]
    fn script_binds_keyspace_and_sets_ttls() {
        assert!(LUA.contains("EXPIRE"));
        assert!(LUA.contains("globalGuard"));
        assert!(LUA.contains("ARGV[3] == 'protect'"));
        assert_ne!(token_digest(&"a".repeat(64)), "a".repeat(64));
    }
}
