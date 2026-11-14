//! Validated per-OS XHTTP client profile overlays. These are control-plane
//! metadata and MUST NOT be inserted into the deployed server-side inbound.
use serde_json::Value;

const CLIENT_FIELDS: &[&str] = &[
    "mode","headers","xPaddingBytes","uplinkHTTPMethod",
    "uplinkDataPlacement","uplinkDataKey","uplinkChunkSize",
    "scMaxEachPostBytes","scMinPostsIntervalMs","xmux",
];
const XMUX_FIELDS: &[&str] = &[
    "maxConcurrency","maxConnections","cMaxReuseTimes",
    "hMaxRequestTimes","hMaxReusableSecs","hKeepAlivePeriod",
];
const PLATFORMS: &[&str] = &["iOS","Android","Windows","macOS","Linux","Auto"];

fn nonnegative_range(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_i64()
            .is_some_and(|number| (0..=i64::from(i32::MAX)).contains(&number)),
        Value::String(value) => {
            let mut pieces = value.split('-');
            let first = pieces.next().and_then(|s| s.parse::<i64>().ok());
            let second = pieces.next().map(|s| s.parse::<i64>().ok());
            if pieces.next().is_some() { return false; }
            match (first, second) {
                (Some(from), None) => (0..=i64::from(i32::MAX)).contains(&from),
                (Some(from), Some(Some(to))) =>
                    (0..=i64::from(i32::MAX)).contains(&from)
                    && (from..=i64::from(i32::MAX)).contains(&to),
                _ => false,
            }
        }
        _ => false,
    }
}
fn positive_max(value: Option<&Value>) -> bool {
    let Some(v) = value else {return false;};
    if let Some(n)=v.as_i64() {return n>0;}
    v.as_str().and_then(|s|s.split('-').next_back()).and_then(|n|n.parse::<i64>().ok()).is_some_and(|n|n>0)
}
pub(crate) fn validate(inbound: &Value) -> Result<(), &'static str> {
    let Some(profiles) = inbound.get("xmesh")
        .and_then(|v|v.get("xhttpDeviceProfiles"))
        .or_else(||inbound.get("xhttpDeviceProfiles")) else { return Ok(()); };
    if inbound.get("streamSettings").and_then(|v|v.get("network")).and_then(Value::as_str)!=Some("xhttp") {
        return Err("XHTTP device profiles require an XHTTP inbound.");
    }
    let profiles=profiles.as_object().ok_or("xhttpDeviceProfiles must be an object.")?;
    if profiles.len()>PLATFORMS.len() {return Err("Too many device profiles.");}
    for (platform, fields) in profiles {
        if !PLATFORMS.contains(&platform.as_str()) {return Err("Unknown XHTTP device platform.");}
        let fields=fields.as_object().ok_or("Device profile must be an object.")?;
        if fields.len()>CLIENT_FIELDS.len() {return Err("Too many XHTTP device options.");}
        for (name, v) in fields {
            if !CLIENT_FIELDS.contains(&name.as_str()) {return Err("Unsupported client XHTTP device field.");}
            match name.as_str() {
                "mode" if !matches!(v.as_str(),Some("auto"|"packet-up"|"stream-up"|"stream-one")) =>
                    return Err("Invalid XHTTP device mode."),
                "uplinkHTTPMethod" if !matches!(v.as_str(),Some("POST"|"GET")) =>
                    return Err("Invalid XHTTP HTTP method."),
                "uplinkDataPlacement" if !matches!(v.as_str(),Some("auto"|"body"|"cookie"|"header")) =>
                    return Err("Invalid XHTTP uplink placement."),
                "uplinkDataKey" if !v.as_str().is_some_and(|s|s.is_ascii()&&s.len()<=128) =>
                    return Err("Invalid XHTTP uplink data key."),
                "headers" => {
                    let Some(map)=v.as_object() else {return Err("XHTTP headers must be a map.");};
                    if map.len()>16 {return Err("Too many XHTTP headers.");}
                    for (key,value) in map {
                        if key.eq_ignore_ascii_case("host") || key.len()>100 || !key.is_ascii()
                            || value.as_str().is_none_or(|s|s.len()>512||s.chars().any(char::is_control)) {
                            return Err("Invalid XHTTP device header.");
                        }
                    }
                }
                "xPaddingBytes"|"uplinkChunkSize"|"scMaxEachPostBytes"|"scMinPostsIntervalMs"
                    if !nonnegative_range(v) => return Err("Invalid XHTTP numeric range."),
                "xmux" => {
                    let Some(map)=v.as_object() else {return Err("XHTTP xmux must be an object.");};
                    if map.len()>XMUX_FIELDS.len() {return Err("Too many xmux options.");}
                    for (key,val) in map {
                        if !XMUX_FIELDS.contains(&key.as_str()) {return Err("Invalid xmux field.");}
                        if key=="hKeepAlivePeriod" {
                            if !val.as_i64().is_some_and(|n|(-1..=i64::from(i32::MAX)).contains(&n)) {
                                return Err("Invalid xmux keepalive.");
                            }
                        } else if !nonnegative_range(val) {return Err("Invalid xmux range.");}
                    }
                    if positive_max(map.get("maxConcurrency")) && positive_max(map.get("maxConnections")) {
                        return Err("maxConnections conflicts with maxConcurrency.");
                    }
                }
                _ => {}
            }
        }
        let mode=fields.get("mode").and_then(Value::as_str).unwrap_or("auto");
        if fields.get("uplinkHTTPMethod").and_then(Value::as_str)==Some("GET") && mode!="packet-up" {
            return Err("XHTTP GET requires packet-up.");
        }
        if mode!="packet-up" && (fields.contains_key("scMaxEachPostBytes") || fields.contains_key("scMinPostsIntervalMs")) {
            return Err("Packet-up tuning requires packet-up mode.");
        }
        if mode!="packet-up" && matches!(fields.get("uplinkDataPlacement").and_then(Value::as_str),Some("header"|"cookie")) {
            return Err("XHTTP header/cookie uplink requires packet-up.");
        }
    }
    Ok(())
}
/// Client transport overlays are stored alongside XRAY STUDIO profiles but
/// are never valid Xray-core inbound fields. Strip before signing node config.
pub(crate) fn strip_from_node_config(config: &mut Value) {
    if let Some(inbounds) = config.get_mut("inbounds").and_then(Value::as_array_mut) {
        for inbound in inbounds {
            if let Some(map) = inbound.as_object_mut() {
                map.remove("xhttpDeviceProfiles");
                if let Some(xmesh) = map.get_mut("xmesh").and_then(Value::as_object_mut) {
                    xmesh.remove("xhttpDeviceProfiles");
                    if xmesh.is_empty() { map.remove("xmesh"); }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn profile_validation_is_fail_closed() {
        let inbound=json!({"streamSettings":{"network":"xhttp"},"xmesh":{"xhttpDeviceProfiles":{
          "iOS":{"mode":"packet-up","uplinkHTTPMethod":"POST",
            "scMaxEachPostBytes":"131072-524288","scMinPostsIntervalMs":"10-50",
            "xmux":{"maxConcurrency":0,"maxConnections":"3-6","hMaxRequestTimes":"100-300"}},
          "Android":{"mode":"stream-up","xmux":{"maxConcurrency":1,"maxConnections":0}}
        }}});
        assert!(validate(&inbound).is_ok());
        let mut invalid=inbound.clone();
        invalid["xmesh"]["xhttpDeviceProfiles"]["Android"]["xmux"]["maxConnections"]=json!(3);
        assert!(validate(&invalid).is_err());
        invalid=inbound.clone();
        invalid["xmesh"]["xhttpDeviceProfiles"]["iOS"]["privateKey"]=json!("SECRET");
        assert!(validate(&invalid).is_err());
        invalid=inbound.clone();
        invalid["xmesh"]["xhttpDeviceProfiles"]["Android"]["scMinPostsIntervalMs"]=json!("10-50");
        assert!(validate(&invalid).is_err());
        invalid=inbound.clone();
        invalid["xmesh"]["xhttpDeviceProfiles"]["Windows"]=json!({"mode":"stream-up"});
        invalid["streamSettings"]["network"]=json!("tcp");
        assert!(validate(&invalid).is_err());
    }
}
