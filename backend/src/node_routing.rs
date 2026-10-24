//! Per-node server-side routing, separate from GeoData asset management.
//! Nodes are only labels/authoritative destinations; a real Xray outbound
//! with working authentication and transport is mandatory for remote egress.
use crate::ApiError;
use axum::http::StatusCode;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;

fn bad(message: &'static str)->ApiError { ApiError::new(StatusCode::CONFLICT,message) }

fn small_name(value:&str)->bool {
    !value.is_empty() && value.len()<=128
        && value.bytes().all(|b| b.is_ascii_alphanumeric()
            || matches!(b,b'-'|b'_'|b'.'|b':'|b'!'|b'@'|b'/'))
}

fn matcher(kind:&str, raw:&str)->Result<(&'static str,String),ApiError>{
    let value=raw.trim();
    if value.len()>128 || value.is_empty() || value.chars().any(char::is_control){
        return Err(bad("Routing: empty or oversized rule matcher."));
    }
    match kind {
        "geosite" | "geoip" if small_name(value) && !value.contains('/') =>
            Ok((if kind=="geosite"{"domain"}else{"ip"},format!("{kind}:{value}"))),
        "domain" if value.len()<=253 && value.bytes().all(|b|
            b.is_ascii_alphanumeric()||matches!(b,b'.'|b'-')) && value.contains('.') =>
            Ok(("domain",format!("domain:{value}"))),
        "ip" if value.parse::<IpAddr>().is_ok()
            || value.split_once('/').is_some_and(|(ip,mask)|
                ip.parse::<IpAddr>().is_ok() && mask.parse::<u16>().is_ok_and(|prefix|
                    prefix <= (if ip.contains(':'){128}else{32}))) => Ok(("ip",value.into())),
        "extDomain" | "extIp" => {
            let Some((filename,category))=value.split_once(':') else {
                return Err(bad("Routing: custom GeoData needs filename.dat:category."));
            };
            if !filename.ends_with(".dat") || filename.len()>52
                || !filename[..filename.len()-4].bytes().all(|b|
                    b.is_ascii_alphanumeric()||matches!(b,b'-'|b'_'))
                || filename.len()<=4 || !small_name(category) || category.contains(':') {
                return Err(bad("Routing: invalid custom GeoData file/category."));
            }
            Ok((if kind=="extDomain"{"domain"}else{"ip"},format!("ext:{value}")))
        }
        _ => Err(bad("Routing: unsupported or invalid rule matcher."))
    }
}

fn endpoint(outbound:&Value)->Result<(String,u64),ApiError>{
    let proto=outbound.get("protocol").and_then(Value::as_str).unwrap_or("");
    let settings=outbound.get("settings").filter(|v|v.is_object())
        .ok_or_else(||bad("Routing: remote node outbound must have settings."))?;
    let servers=match proto {
        "vless" | "vmess" => settings.get("vnext").and_then(Value::as_array),
        "trojan" | "shadowsocks" | "socks" | "http" =>
            settings.get("servers").and_then(Value::as_array),
        _ => return Err(bad("Routing: remote node requires a supported proxy outbound (VLESS, VMess, Trojan, Shadowsocks, SOCKS, HTTP)."))
    }.ok_or_else(||bad("Routing: remote proxy outbound is missing servers/vnext."))?;
    if servers.len()!=1 {
        return Err(bad("Routing: remote proxy must specify exactly one server."));
    }
    let server=&servers[0];
    let address=server.get("address").and_then(Value::as_str).unwrap_or("");
    let port=server.get("port").and_then(Value::as_u64).unwrap_or(0);
    if address.is_empty() || !(1..=65535).contains(&port){
        return Err(bad("Routing: remote proxy needs a valid address and port."));
    }
    if address.len()>253 || address.contains('/') || address.contains('@') || address.chars().any(char::is_whitespace){
        return Err(bad("Routing: invalid remote proxy address."));
    }
    let users=server.get("users").and_then(Value::as_array);
    if matches!(proto,"vless"|"vmess") {
        let Some(users)=users.filter(|u|!u.is_empty()) else {
            return Err(bad("Routing: VLESS/VMess remote outbound requires authorized users."));
        };
        if users.iter().any(|user|!user.get("id").and_then(Value::as_str)
            .is_some_and(|id|uuid::Uuid::parse_str(id).is_ok())) {
            return Err(bad("Routing: remote outbound needs a valid VLESS/VMess UUID."));
        }
    }
    if matches!(proto,"trojan"|"shadowsocks") && server.get("password").and_then(Value::as_str).unwrap_or("").is_empty() {
        return Err(bad("Routing: remote outbound requires the server password."));
    }
    Ok((address.to_ascii_lowercase(),port))
}

fn permitted_endpoint(remote:&Value, hosts:&[Value],address:&str,port:u64)->bool {
    let target_id=remote.get("id").and_then(Value::as_i64).unwrap_or(0);
    let mut allowed=Vec::<(String,Option<u64>)>::new();
    for key in ["addr","externalAddress","publicAddress"] {
        if let Some(s)=remote.get(key).and_then(Value::as_str).filter(|s|!s.is_empty()){
            // Raw node IP may use another public port through a custom router;
            // only accept the node's published port for this fallback.
            allowed.push((s.to_ascii_lowercase(),remote.get("port").and_then(Value::as_u64)));
        }
    }
    for host in hosts {
        if host.get("disabled").and_then(Value::as_bool)==Some(true){continue}
        if !host.get("nodes").and_then(Value::as_array).is_some_and(|ids|
            ids.iter().any(|id|id.as_i64()==Some(target_id))){continue}
        for key in ["address","externalAddress"] {
            if let Some(s)=host.get(key).and_then(Value::as_str).filter(|s|!s.is_empty()){
                allowed.push((s.to_ascii_lowercase(),host.get("externalPort")
                    .and_then(Value::as_u64).or_else(||host.get("port").and_then(Value::as_u64))));
            }
        }
    }
    allowed.iter().any(|(a,p)|a==address && p.is_some_and(|p|p==port))
}

fn cycle_reaches(start:i64, goal:i64,nodes:&[Value])->bool{
    let by_id:HashMap<i64,&Value>=nodes.iter().filter_map(|n|
        n.get("id").and_then(Value::as_i64).map(|id|(id,n))).collect();
    let mut pending=vec![start];
    let mut visited=HashSet::new();
    while let Some(id)=pending.pop(){
        if id==goal{return true}
        if !visited.insert(id) {continue}
        if visited.len()>1000{return true} // fail closed on abnormal graphs
        let Some(node)=by_id.get(&id) else{continue};
        if node.get("routingEnabled").and_then(Value::as_bool)!=Some(true){continue}
        for rule in node.get("routingRules").and_then(Value::as_array).into_iter().flatten(){
            if rule.get("enabled").and_then(Value::as_bool)==Some(false) || rule.get("target").and_then(Value::as_str)!=Some("node"){continue}
            if let Some(next)=rule.get("nodeId").and_then(Value::as_i64){pending.push(next);}
        }
    }
    false
}

/// Validate persistent routing input before storing a node record. The
/// dynamic cross-node graph and endpoint identity checks happen in apply().
pub fn validate_saved(node:&Value)->Result<(),ApiError>{
    for name in ["routingEnabled","routingSniffing"]{
        if node.get(name).is_some_and(|v|!v.is_boolean()){
            return Err(bad("Routing: enable/sniffing switches must be boolean."));
        }
    }
    if node.get("routingDomainStrategy").is_some_and(|v|
        !matches!(v.as_str(),Some("AsIs"|"IPIfNonMatch"|"IPOnDemand"))){
        return Err(bad("Routing: invalid domain strategy."));
    }
    if let Some(rules)=node.get("routingRules"){
        let rules=rules.as_array().ok_or_else(||bad("Routing: rules must be an array."))?;
        if rules.len()>64{return Err(bad("Routing: too many rules."))}
        for rule in rules {
            if !rule.is_object(){return Err(bad("Routing: every rule must be an object."))}
            if rule.get("enabled").is_some_and(|x|!x.is_boolean()){
                return Err(bad("Routing: rule activation must be boolean."));
            }
            if rule.get("enabled").and_then(Value::as_bool)==Some(false)
                || node.get("routingEnabled").and_then(Value::as_bool)!=Some(true){continue}
            let kind=rule.get("matcher").and_then(Value::as_str)
                .ok_or_else(||bad("Routing: rule type is missing."))?;
            let raw=rule.get("value").and_then(Value::as_str)
                .ok_or_else(||bad("Routing: rule value is missing."))?;
            matcher(kind,raw)?;
            if matches!(kind,"geosite"|"geoip"|"extDomain"|"extIp")
                && node.get("geoEnabled").and_then(Value::as_bool)!=Some(true) {
                return Err(bad("Routing: GeoData must remain enabled while GeoSite/GeoIP rules are active."));
            }
            match rule.get("target").and_then(Value::as_str) {
                Some("direct"|"block")=>{},
                Some("outbound") if rule.get("outboundTag").and_then(Value::as_str)
                    .is_some_and(|tag|!tag.is_empty() && tag.len()<=128)=>{},
                Some("node") if rule.get("nodeId").and_then(Value::as_i64)
                    .is_some_and(|id|id>0)=>{},
                _=>return Err(bad("Routing: invalid destination for an enabled rule."))
            }
        }
    } else if node.get("routingEnabled").and_then(Value::as_bool)==Some(true){
        return Err(bad("Routing: enable requires a rules array."));
    }
    if let Some(relays)=node.get("routingRelays"){
        let relays=relays.as_array().ok_or_else(||bad("Routing: exit definitions must be an array."))?;
        if relays.len()>16{return Err(bad("Routing: too many exit definitions."))}
        let mut seen=HashSet::new();
        for relay in relays {
            let id=relay.get("nodeId").and_then(Value::as_i64)
                .filter(|id|*id>0).ok_or_else(||bad("Routing: exit node ID is invalid."))?;
            if !seen.insert(id){return Err(bad("Routing: duplicate exit node definition."))}
            let config=relay.get("outbound")
                .filter(|v|v.is_object()).ok_or_else(||bad("Routing: invalid exit outbound JSON."))?;
            if serde_json::to_vec(config).unwrap_or_default().len()>24576 {
                return Err(bad("Routing: exit configuration is too large."));
            }
        }
    } else if node.get("routingEnabled").and_then(Value::as_bool)==Some(true){
        return Err(bad("Routing: enable requires an exit definitions array."));
    }
    Ok(())
}

pub fn apply(node:&Value,config:&mut Value,nodes:&[Value],hosts:&[Value])->Result<(),ApiError>{
    if node.get("routingEnabled").and_then(Value::as_bool)!=Some(true){return Ok(())}
    let rules=node.get("routingRules").and_then(Value::as_array)
        .ok_or_else(||bad("Routing: rules must be a JSON array."))?;
    if rules.len()>64 {return Err(bad("Routing: at most 64 rules per node."))}
    let relays=node.get("routingRelays").and_then(Value::as_array)
        .ok_or_else(||bad("Routing: relay definitions must be a JSON array."))?;
    if relays.len()>16{return Err(bad("Routing: at most 16 remote exits."))}
    let strategy=node.get("routingDomainStrategy").and_then(Value::as_str).unwrap_or("AsIs");
    if !matches!(strategy,"AsIs"|"IPIfNonMatch"|"IPOnDemand"){
        return Err(bad("Routing: unsupported domainStrategy."));
    }
    let node_id=node.get("id").and_then(Value::as_i64).unwrap_or(0);
    let config_outbounds=config.get("outbounds").and_then(Value::as_array)
        .ok_or_else(||bad("Routing: XRAY STUDIO profile requires outbounds."))?;
    let mut known_tags=HashSet::<String>::new();
    let mut freedom:Option<String>=None;
    for outbound in config_outbounds {
        // Xray allows unnamed default outbounds. They cannot be selected by
        // outboundTag; skip them instead of rejecting unrelated routing rules.
        let Some(tag)=outbound.get("tag").and_then(Value::as_str)
            .filter(|tag|!tag.is_empty()) else{continue};
        if !known_tags.insert(tag.into()){return Err(bad("Routing: duplicate outbound tag in profile."))}
        if freedom.is_none() && outbound.get("protocol").and_then(Value::as_str)==Some("freedom"){
            freedom=Some(tag.into());
        }
    }
    let mut generated=Vec::<Value>::new();
    let mut added=Vec::<Value>::new();
    let mut need_block=false;
    let mut needs_domain_sniffing=false;
    let mut visited_exits=HashSet::<i64>::new();
    for (index,entry) in rules.iter().enumerate(){
        if entry.get("enabled").and_then(Value::as_bool)==Some(false){continue}
        let kind=entry.get("matcher").and_then(Value::as_str)
            .ok_or_else(||bad("Routing: rule matcher is missing."))?;
        let raw=entry.get("value").and_then(Value::as_str)
            .ok_or_else(||bad("Routing: rule value is missing."))?;
        let (key,value)=matcher(kind,raw)?;
        if key=="domain" {needs_domain_sniffing=true;}
        if matches!(kind,"geosite"|"geoip"|"extDomain"|"extIp")
            && node.get("geoEnabled").and_then(Value::as_bool)!=Some(true){
            return Err(bad("Routing: enable GeoData downloads on the source node first."));
        }
        let outbound=match entry.get("target").and_then(Value::as_str).unwrap_or("") {
            "direct"=>freedom.clone().ok_or_else(||bad("Routing: profile has no freedom outbound."))?,
            "block"=>{
                need_block=true;
                "xmesh_route_block".into()
            }
            "outbound"=>{
                let tag=entry.get("outboundTag").and_then(Value::as_str)
                    .ok_or_else(||bad("Routing: specify an outbound tag."))?;
                if tag=="xmesh_stats_api" || !known_tags.contains(tag){
                    return Err(bad("Routing: chosen outbound tag is missing or reserved."));
                }
                tag.into()
            }
            "node"=>{
                let target_id=entry.get("nodeId").and_then(Value::as_i64).unwrap_or(0);
                if target_id<=0 || target_id==node_id {
                    return Err(bad("Routing: choose a different existing exit node."));
                }
                let remote=nodes.iter().find(|n|n.get("id").and_then(Value::as_i64)==Some(target_id))
                    .ok_or_else(||bad("Routing: selected exit node was deleted."))?;
                if remote.get("disabled").and_then(Value::as_bool)==Some(true){
                    return Err(bad("Routing: selected exit node is disabled."));
                }
                if cycle_reaches(target_id,node_id,nodes){
                    return Err(bad("Routing: this exit would create a node-to-node routing cycle."));
                }
                let tag=format!("xmesh_exit_node_{target_id}");
                if visited_exits.insert(target_id){
                    if known_tags.contains(&tag){
                        return Err(bad("Routing: a profile outbound conflicts with a reserved exit tag."));
                    }
                    let spec=relays.iter().find(|v|v.get("nodeId").and_then(Value::as_i64)==Some(target_id))
                        .ok_or_else(||bad("Routing: select a working proxy connection for the exit node first."))?;
                    let mut outbound=spec.get("outbound").and_then(Value::as_object).cloned()
                        .ok_or_else(||bad("Routing: exit node requires outbound JSON."))?;
                    let json_bytes=serde_json::to_vec(&outbound).unwrap_or_default();
                    if json_bytes.len()>24576 {
                        return Err(bad("Routing: exit outbound JSON exceeds 24 KiB."));
                    }
                    // Refuse local filesystem transports and administrator overrides
                    // that can cause unexpected bind/proxy routing or file access.
                    if outbound.contains_key("sendThrough") || outbound.contains_key("tag")
                        || outbound.get("streamSettings").and_then(|s|s.get("xdriveSettings")).is_some()
                        || outbound.get("streamSettings").and_then(|s|s.get("tlsSettings"))
                            .and_then(|s|s.get("certificates")).is_some()
                        || outbound.get("streamSettings").and_then(|s|s.get("realitySettings"))
                            .and_then(|s|s.get("privateKey")).is_some(){
                        return Err(bad("Routing: remote outbound includes unsafe or reserved fields."));
                    }
                    let (address,port)=endpoint(&Value::Object(outbound.clone()))?;
                    if !permitted_endpoint(remote,hosts,&address,port){
                        return Err(bad("Routing: exit outbound address:port must match the exit node or a Host explicitly linked to it."));
                    }
                    outbound.insert("tag".into(),json!(tag));
                    added.push(Value::Object(outbound));
                }
                tag
            }
            _=>return Err(bad("Routing: select direct, block, existing outbound, or exit node."))
        };
        let mut rule=json!({"type":"field","outboundTag":outbound,
            "ruleTag":format!("xmesh-{index}")});
        rule[key]=json!([value]);
        generated.push(rule);
    }
    if generated.is_empty(){return Ok(())}
    if need_block{
        if known_tags.contains("xmesh_route_block"){
            return Err(bad("Routing: profile outbound conflicts with reserved block tag."));
        }
        added.push(json!({"tag":"xmesh_route_block","protocol":"blackhole"}));
    }
    let obj=config.as_object_mut().ok_or_else(||bad("Routing: Xray config is not an object."))?;
    obj.get_mut("outbounds").and_then(Value::as_array_mut).unwrap().extend(added);
    let routing=obj.entry("routing").or_insert_with(||json!({}));
    let routing=routing.as_object_mut().ok_or_else(||bad("Routing: profile routing is not an object."))?;
    routing.insert("domainStrategy".into(),json!(strategy));
    let configured=routing.entry("rules").or_insert_with(||json!([]));
    let configured=configured.as_array_mut().ok_or_else(||bad("Routing: profile routing.rules is not an array."))?;
    // Never displace the mandatory StatsService route.
    let protected=configured.iter().take_while(|rule|
        rule.get("inboundTag").and_then(Value::as_array).is_some_and(|tags|
            tags.iter().any(|v|v.as_str()==Some("xmesh_stats_in")))).count();
    configured.splice(protected..protected,generated);
    // Domain route matching requires the destination domain. IP-only VLESS
    // requests often hide it; sniff TLS SNI / HTTP Host for ROUTING ONLY.
    // Never rewrite the actual network destination in this control plane.
    if needs_domain_sniffing && node.get("routingSniffing").and_then(Value::as_bool)!=Some(false) {
        let inbound=obj.get_mut("inbounds").and_then(Value::as_array_mut)
            .and_then(|list|list.first_mut())
            .ok_or_else(||bad("Routing: source profile must have a proxy inbound."))?;
        let sniff=inbound.as_object_mut().ok_or_else(||bad("Routing: invalid inbound."))?
            .entry("sniffing").or_insert_with(||json!({}));
        let sniff=sniff.as_object_mut().ok_or_else(||bad("Routing: invalid sniffing settings."))?;
        sniff.insert("enabled".into(),json!(true));
        sniff.insert("routeOnly".into(),json!(true));
        let overrides=sniff.entry("destOverride").or_insert_with(||json!([]));
        let overrides=overrides.as_array_mut()
            .ok_or_else(||bad("Routing: sniffing.destOverride must be an array."))?;
        for proto in ["http","tls","quic"] {
            if !overrides.iter().any(|x|x.as_str()==Some(proto)) { overrides.push(json!(proto)); }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    fn sample()->Value{
        json!({"inbounds":[{"protocol":"vless","tag":"NL","settings":{}}],
            "routing":{"rules":[
            {"type":"field","inboundTag":["xmesh_stats_in"],"outboundTag":"xmesh_stats_api"},
            {"type":"field","inboundTag":["NL"],"outboundTag":"direct"}]},
            "outbounds":[{"protocol":"freedom","tag":"direct"}]})
    }
    #[test]
    fn geosite_to_real_exit_preserves_stats_order(){
        let node=json!({"id":4,"geoEnabled":true,"routingEnabled":true,
            "routingRules":[{"matcher":"geosite","value":"category-ru","target":"node","nodeId":10}],
            "routingRelays":[{"nodeId":10,"outbound":{"protocol":"vless","settings":{
                "vnext":[{"address":"moscow.example.com","port":443,
                    "users":[{"id":"550e8400-e29b-41d4-a716-446655440000","encryption":"none"}]}]}}}]});
        let nodes=vec![node.clone(),json!({"id":10,"name":"Москва","addr":"moscow.example.com","port":443})];
        let mut config=sample();
        apply(&node,&mut config,&nodes,&[]).unwrap();
        assert_eq!(config["routing"]["rules"][0]["outboundTag"],"xmesh_stats_api");
        assert_eq!(config["routing"]["rules"][1]["outboundTag"],"xmesh_exit_node_10");
        assert_eq!(config["routing"]["rules"][1]["domain"][0],"geosite:category-ru");
        assert_eq!(config["routing"]["rules"][2]["outboundTag"],"direct");
        assert_eq!(config["outbounds"][1]["protocol"],"vless");
        assert_eq!(config["inbounds"][0]["sniffing"]["enabled"],true);
        assert_eq!(config["inbounds"][0]["sniffing"]["routeOnly"],true);
    }
    #[test]
    fn reject_phantom_node_with_no_transport(){
        let node=json!({"id":4,"geoEnabled":true,"routingEnabled":true,
            "routingRules":[{"matcher":"geosite","value":"ru","target":"node","nodeId":10}],
            "routingRelays":[]});
        let mut config=sample();
        assert!(apply(&node,&mut config,&[node.clone(),json!({"id":10})],&[]).is_err());
    }
    #[test]
    fn reject_outbound_to_wrong_node_and_loop(){
        let node=json!({"id":4,"geoEnabled":true,"routingEnabled":true,
            "routingRules":[{"matcher":"geosite","value":"ru","target":"node","nodeId":10}],
            "routingRelays":[{"nodeId":10,"outbound":{"protocol":"vless","settings":{
                "vnext":[{"address":"wrong.example.com","port":443,"users":[{"id":"id"}]}]}}}]});
        let nodes=vec![node.clone(),json!({"id":10,"addr":"moscow.example.com","port":443})];
        let mut config=sample();
        assert!(apply(&node,&mut config,&nodes,&[]).is_err());
        let linked=json!({"id":10,"addr":"wrong.example.com","port":443,
            "routingEnabled":true,"routingRules":[{"enabled":true,"target":"node","nodeId":4}]});
        assert!(apply(&node,&mut config,&[node.clone(),linked],&[]).is_err());
    }
    #[test]
    fn cannot_disable_geodata_under_an_active_geo_rule(){
        assert!(validate_saved(&json!({"geoEnabled":false,"routingEnabled":true,
            "routingRules":[{"matcher":"geosite","value":"category-ru","target":"block"}],
            "routingRelays":[]})).is_err());
    }
    #[test]
    fn saved_policy_rejects_nonboolean_toggle_and_duplicate_exit(){
        assert!(validate_saved(&json!({"routingEnabled":"yes"})).is_err());
        assert!(validate_saved(&json!({"routingEnabled":true,"routingRules":[],"routingRelays":[
            {"nodeId":10,"outbound":{}},{"nodeId":10,"outbound":{}}]})).is_err());
        assert!(validate_saved(&json!({"routingEnabled":false,"routingRules":[
            {"matcher":"geosite","value":"","target":"node","nodeId":0}],"routingRelays":[]})).is_ok());
    }
    #[test]
    fn direct_block_and_existing_proxy_are_first_match(){
        let node=json!({"id":1,"routingEnabled":true,"geoEnabled":true,
            "routingDomainStrategy":"IPIfNonMatch",
            "routingRules":[
                {"matcher":"geosite","value":"category-ads-all","target":"block"},
                {"matcher":"domain","value":"example.ru","target":"outbound","outboundTag":"moscow"},
                {"matcher":"geoip","value":"ru","target":"direct"}],
            "routingRelays":[]});
        let mut config=sample();
        config["outbounds"].as_array_mut().unwrap().push(json!({"tag":"moscow","protocol":"vless"}));
        apply(&node,&mut config,&[],&[]).unwrap();
        assert_eq!(config["routing"]["rules"][1]["outboundTag"],"xmesh_route_block");
        assert_eq!(config["routing"]["rules"][2]["outboundTag"],"moscow");
        assert_eq!(config["routing"]["rules"][3]["outboundTag"],"direct");
        assert_eq!(config["routing"]["domainStrategy"],"IPIfNonMatch");
    }
}