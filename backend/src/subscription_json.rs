//! XMesh JSON Engine: one fail-closed assembler for public native Xray subscriptions.
//! Outbounds are produced from allowlisted client fields by user_subscriptions,
//! never by copying a server inbound/Reality private key into a client profile.
use serde_json::{json,Value};
use std::collections::{HashMap,HashSet};

fn option<'a>(config:&'a Value, key:&str, values:&[&str], fallback:&'a str)->&'a str {
    config.get(key).and_then(Value::as_str).filter(|s|values.contains(s)).unwrap_or(fallback)
}
fn enabled(config:&Value,key:&str,default:bool)->bool{
    config.get(key).and_then(Value::as_bool).unwrap_or(default)
}
fn port(config:&Value,key:&str,default:u16)->u16{
    config.get(key).and_then(Value::as_u64)
        .and_then(|v|u16::try_from(v).ok()).filter(|v|*v>=1024).unwrap_or(default)
}
fn country(outbound:&Value)->String{
    let code=outbound.get("xmeshCountry").and_then(Value::as_str).unwrap_or("ZZ");
    let code=code.trim().to_ascii_uppercase();
    if code.len()==2 && code.bytes().all(|c|c.is_ascii_alphabetic()) && code!="ZZ"{return code}
    // Preserve country grouping when the admin uses a flag in the server label.
    let label=outbound.get("tag").and_then(Value::as_str).unwrap_or("");
    let mut flags=label.chars();
    if let (Some(a),Some(b))=(flags.next(),flags.next()){
        let ia=a as u32;let ib=b as u32;
        if (0x1f1e6..=0x1f1ff).contains(&ia)&&(0x1f1e6..=0x1f1ff).contains(&ib){
            let left=char::from_u32(u32::from(b'A')+ia-0x1f1e6).unwrap_or('Z');
            let right=char::from_u32(u32::from(b'A')+ib-0x1f1e6).unwrap_or('Z');
            return format!("{left}{right}")
        }
    }
    // Legacy Hosts often have only a human-readable country name. Infer
    // familiar locations without requiring users to enter ISO codes twice.
    let normalized=label.trim().to_lowercase();
    for (name,code) in [
        ("нидерланды","NL"),("netherlands","NL"),("holland","NL"),
        ("швеция","SE"),("sweden","SE"),
        ("германия","DE"),("germany","DE"),
        ("польша","PL"),("poland","PL"),
        ("эстония","EE"),("estonia","EE"),
        ("финляндия","FI"),("finland","FI"),
        ("россия","RU"),("russia","RU"),
        ("франция","FR"),("france","FR"),
        ("сша","US"),("united states","US"),
        ("великобритания","GB"),("united kingdom","GB"),
        ("испания","ES"),("spain","ES"),
    ] {
        if normalized==name || normalized.starts_with(&format!("{name} "))
            || normalized.starts_with(&format!("{name}-")) {
            return code.to_owned();
        }
    }
    "ZZ".to_owned()
}
fn secure_vless(outbound:&Value)->bool {
    let user=&outbound["settings"]["vnext"][0]["users"][0];
    let encryption=user["encryption"].as_str().unwrap_or("none");
    let security=outbound["streamSettings"]["security"].as_str().unwrap_or("none");
    match security {
        "tls"|"reality"=>true,
        "none"=>encryption.starts_with("mlkem768x25519plus."),
        _=>false
    }
}
/// Every proxy passed into this engine must be fully public-side serialized.
pub(crate) fn build(mut proxies:Vec<Value>,setting:&Value)->Result<Value,String>{
    if proxies.is_empty(){return Err("Нет доступных клиентских подключений".into())}
    if proxies.len()>256{return Err("Превышен лимит подключений в одной подписке".into())}
    let opts=setting.get("subscriptionJson").unwrap_or(&Value::Null);
    let dns_mode=option(opts,"dns",&["cloudflare","yandex","system"],"cloudflare");
    let dns_server=match dns_mode {
        "yandex"=>"https://common.dot.dns.yandex.net/dns-query",
        "system"=>"localhost",
        _=>"https://cloudflare-dns.com/dns-query"
    };
    let query_strategy=option(opts,"queryStrategy",&["UseIPv4","UseIPv6","UseIP"],"UseIPv4");
    let routing_strategy=option(opts,"routingStrategy",&["AsIs","IPIfNonMatch","IPOnDemand"],"IPIfNonMatch");
    let balance=option(opts,"balance",&["leastPing","roundRobin","random","off"],"leastPing");
    let smart=enabled(opts,"smart",true);
    let sniffing=enabled(opts,"sniffing",true);
    let dns_out=enabled(opts,"dnsRouting",true);
    let socks_port=port(opts,"socksPort",10808);
    let http_port=port(opts,"httpPort",10809);
    if socks_port==http_port{return Err("Локальные SOCKS и HTTP порты совпадают".into())}
    let mut used=HashSet::new();
    let mut countries:HashMap<String,Vec<String>>=HashMap::new();
    let mut tags=Vec::new();
    // An Xray routing tag is not a human-readable server name. Preserve
    // the host's real subscription remark separately for GUI clients.
    let display_names:Vec<String>=proxies.iter().map(|p|
        p.get("tag").and_then(Value::as_str).unwrap_or("").trim().chars()
            .filter(|c|!c.is_control()).take(100).collect()
    ).collect();
    for (i,outbound) in proxies.iter_mut().enumerate(){
        if outbound["protocol"]!="vless"{
            return Err("Неподдерживаемый протокол в клиентском JSON".into())
        }
        if !secure_vless(outbound) {
            return Err("Обнаружено VLESS-подключение без TLS/REALITY или VLESS Encryption".into())
        }
        let address=outbound["settings"]["vnext"][0]["address"].as_str().unwrap_or("");
        if address.is_empty(){return Err("Не указан публичный адрес сервера".into())}
        let code=country(outbound);
        // Xray routing tags are internal identifiers, never display labels.
        // Keep them stable, unique and ASCII-only regardless of host names.
        let tag=format!("xmesh-{code}-{:04}",i+1);
        if !used.insert(tag.clone()){return Err("Дублирующийся тег Xray".into())}
        outbound.as_object_mut().ok_or("Неверная структура outbound")?.remove("xmeshCountry");
        outbound["tag"]=json!(tag);
        tags.push(tag.clone());
        countries.entry(code).or_default().push(tag);
    }
    let first=tags.first().ok_or("Отсутствует маршрут по умолчанию")?.clone();
    let mut balancers:Vec<Value>=Vec::new();
    let mut rules=vec![
        json!({"type":"field","ip":["geoip:private"],"outboundTag":"direct"}),
        json!({"type":"field","domain":["geosite:private"],"outboundTag":"direct"}),
    ];
    if dns_out {
        rules.push(json!({"type":"field","inboundTag":["socks","http"],"port":53,
            "network":"tcp,udp","outboundTag":"dns-out"}));
    }
    let mut observation=false;
    if smart && tags.len()>1 && balance!="off" {
        let mut group_names:Vec<String>=countries.keys().cloned().collect();
        group_names.sort();
        for code in group_names {
            let members=&countries[&code];
            if members.len()<2 || code=="ZZ"{continue}
            let tag=format!("{code}_AUTO");
            balancers.push(json!({
                "tag":tag,"selector":[format!("xmesh-{code}-")],
                "fallbackTag":members[0],"strategy":{"type":balance}
            }));
        }
        balancers.push(json!({
            "tag":"SMART","selector":["xmesh-"],
            "fallbackTag":first,"strategy":{"type":balance}
        }));
        observation=balance=="leastPing";
        rules.push(json!({"type":"field","inboundTag":["socks","http"],"balancerTag":"SMART"}));
    }else{
        rules.push(json!({"type":"field","inboundTag":["socks","http"],"outboundTag":first}));
    }
    let mut inbounds=vec![
        json!({"tag":"socks","listen":"127.0.0.1","port":socks_port,"protocol":"socks",
         "settings":{"auth":"noauth","udp":true}}),
        json!({"tag":"http","listen":"127.0.0.1","port":http_port,"protocol":"http"})
    ];
    if sniffing{
        for inbound in &mut inbounds{
            inbound["sniffing"]=json!({"enabled":true,"destOverride":["http","tls","quic"],"routeOnly":true});
        }
    }
    proxies.push(json!({"tag":"direct","protocol":"freedom","settings":{"domainStrategy":"AsIs"}}));
    proxies.push(json!({"tag":"block","protocol":"blackhole"}));
    if dns_out {
        proxies.push(json!({"tag":"dns-out","protocol":"dns"}));
    }
    let mut routing=json!({"domainStrategy":routing_strategy,"rules":rules});
    if !balancers.is_empty(){routing["balancers"]=json!(balancers)}
    let display_name=if display_names.len()==1 && !display_names[0].is_empty(){
        display_names[0].clone()
    }else{
        setting.get("subscriptionName").and_then(Value::as_str)
            .filter(|s|!s.is_empty() && s.chars().count()<=100)
            .unwrap_or("XMesh SMART").to_owned()
    };
    let mut config=json!({
        "remarks":display_name,
        "log":{"loglevel":"warning"},
        "dns":{"queryStrategy":query_strategy,"servers":[dns_server]},
        "inbounds":inbounds,
        "outbounds":proxies,
        "routing":routing
    });
    if observation{
        config["observatory"]=json!({
            "subjectSelector":["xmesh-"],
            "probeUrl":"https://www.gstatic.com/generate_204",
            "probeInterval":"1m",
            "enableConcurrency":false
        });
    }
    Ok(config)
}

/// Reject unknown or unsafe JSON Engine configuration instead of silently
/// accepting privileged raw Xray fields from the appearance settings API.
pub(crate) fn validate_settings(settings:&Value)->Result<(),String>{
 let object=settings.as_object().ok_or("JSON Engine settings must be an object")?;
 if object.len()>16{return Err("Too many JSON Engine settings".into())}
 for (key,value) in object{
  match key.as_str(){
   "dns"=>{if !["cloudflare","yandex","system"].contains(&value.as_str().unwrap_or("")){return Err("Unsupported DNS provider".into())}},
   "queryStrategy"=>{if !["UseIPv4","UseIPv6","UseIP"].contains(&value.as_str().unwrap_or("")){return Err("Invalid DNS query strategy".into())}},
   "routingStrategy"=>{if !["AsIs","IPIfNonMatch","IPOnDemand"].contains(&value.as_str().unwrap_or("")){return Err("Invalid routing strategy".into())}},
   "balance"=>{if !["leastPing","roundRobin","random","off"].contains(&value.as_str().unwrap_or("")){return Err("Invalid balancer strategy".into())}},
   "smart"|"sniffing"|"dnsRouting"=>{if !value.is_boolean(){return Err(format!("{key} must be boolean"))}},
   "socksPort"|"httpPort"=>{let p=value.as_u64().unwrap_or(0);if !(1024..=65535).contains(&p){return Err("Invalid local proxy port".into())}},
   _=>return Err(format!("Unknown JSON Engine setting: {key}"))
  }
 }
 if object.get("socksPort").and_then(Value::as_u64)==object.get("httpPort").and_then(Value::as_u64)
   && object.get("socksPort").is_some(){return Err("SOCKS and HTTP ports must be distinct".into())}
 Ok(())
}

#[cfg(test)]
mod tests{
 use super::*;
 fn outbound(code:&str)->Value{
  json!({"tag":"User-facing label","xmeshCountry":code,"protocol":"vless",
   "settings":{"vnext":[{"address":"vpn.example.com","port":443,
   "users":[{"id":"550e8400-e29b-41d4-a716-446655440000","encryption":"none"}]}]},
   "streamSettings":{"security":"reality","network":"xhttp",
   "realitySettings":{"serverName":"example.com","publicKey":"public","shortId":"aa"},
   "xhttpSettings":{"path":"/test","mode":"stream-up"}}})
 }
 #[test] fn smart_balancer_observatory_and_country(){
  let config=build(vec![outbound("DE"),outbound("DE"),outbound("PL")],&json!({})).unwrap();
  assert_eq!(config["routing"]["balancers"][0]["tag"],"DE_AUTO");
  assert_eq!(config["routing"]["balancers"][1]["tag"],"SMART");
  assert_eq!(config["routing"]["rules"][3]["balancerTag"],"SMART");
  assert_eq!(config["observatory"]["subjectSelector"][0],"xmesh-");
  assert_ne!(config["outbounds"][0]["tag"],config["outbounds"][1]["tag"]);
  assert!(config["outbounds"][0].get("xmeshCountry").is_none());
 }
 #[test] fn unicode_host_label_never_leaks_into_routing_tags(){
  let mut a=outbound("NL");a["tag"]=json!("Нидерланды 🥷");
  let mut b=outbound("NL");b["tag"]=json!("Другой CDN 🇳🇱");
  let c=build(vec![a,b],&json!({})).unwrap();
  assert_eq!(c["outbounds"][0]["tag"],"xmesh-NL-0001");
  assert_eq!(c["outbounds"][1]["tag"],"xmesh-NL-0002");
  assert_eq!(c["routing"]["balancers"][0]["tag"],"NL_AUTO");
  for outbound in c["outbounds"].as_array().unwrap(){
   assert!(outbound["tag"].as_str().unwrap().is_ascii());
  }
  assert_eq!(c["routing"]["rules"][3]["balancerTag"],"SMART");
 }
 #[test] fn unicode_single_host_default_route_is_ascii(){
  let mut a=outbound("ZZ");a["tag"]=json!("Нидерланды");
  let c=build(vec![a],&json!({})).unwrap();
  assert_eq!(c["outbounds"][0]["tag"],"xmesh-NL-0001");
  assert_eq!(c["routing"]["rules"][3]["outboundTag"],"xmesh-NL-0001");
 }
 #[test] fn host_remark_is_displayed_without_polluting_xray_tags(){
  let mut a=outbound("ZZ");a["tag"]=json!("Нидерланды");
  let c=build(vec![a],&json!({})).unwrap();
  assert_eq!(c["remarks"],"Нидерланды");
  assert_eq!(c["outbounds"][0]["tag"],"xmesh-NL-0001");
  assert_eq!(c["routing"]["rules"][3]["outboundTag"],"xmesh-NL-0001");
 }
 #[test] fn arbitrary_unicode_label_stays_only_in_display_remark(){
  let mut a=outbound("ZZ");a["tag"]=json!("🌍 Premium Zone");
  let c=build(vec![a],&json!({})).unwrap();
  assert_eq!(c["remarks"],"🌍 Premium Zone");
  assert_eq!(c["outbounds"][0]["tag"],"xmesh-ZZ-0001");
 }
 #[test] fn one_node_uses_direct_tag_without_empty_balancers(){
  let c=build(vec![outbound("PL")],&json!({})).unwrap();
  assert!(c["routing"]["rules"][3]["outboundTag"].as_str().unwrap().starts_with("xmesh-PL-0001"));
  assert!(c.get("observatory").is_none());
 }
 #[test] fn insecure_public_vless_is_rejected(){
  let mut x=outbound("PL");x["streamSettings"]["security"]=json!("none");
  assert!(build(vec![x.clone()],&json!({})).is_err());
  x["settings"]["vnext"][0]["users"][0]["encryption"]=json!("mlkem768x25519plus.native.1rtt.key");
  assert!(build(vec![x],&json!({})).is_ok());
 }
 #[test] fn custom_dns_balancing_and_ports(){
  let c=build(vec![outbound("DE"),outbound("PL")],&json!({"subscriptionJson":{
   "balance":"roundRobin","dns":"yandex","socksPort":10812,"httpPort":10813,
   "smart":true,"dnsRouting":false,"sniffing":false}})).unwrap();
  assert_eq!(c["routing"]["balancers"][0]["strategy"]["type"],"roundRobin");
  assert_eq!(c["inbounds"][0]["port"],10812);
  assert!(c.get("observatory").is_none());
  assert!(!c["outbounds"].as_array().unwrap().iter().any(|v|v["tag"]=="dns-out"));
  assert!(c["dns"]["servers"][0].as_str().unwrap().contains("yandex"));
 }
 #[test] fn flag_prefix_groups_country_without_explicit_code(){
  let mut a=outbound("ZZ");a["tag"]=json!("🇵🇱Польша-1");
  let mut b=outbound("ZZ");b["tag"]=json!("🇵🇱Польша-2");
  let c=build(vec![a,b],&json!({})).unwrap();
  assert_eq!(c["routing"]["balancers"][0]["tag"],"PL_AUTO");
 }
 #[test] fn duplicated_public_ip_does_not_delete_nodes(){
  let mut a=outbound("DE");let mut b=outbound("PL");
  a["settings"]["vnext"][0]["address"]=json!("203.0.113.8");
  b["settings"]["vnext"][0]["address"]=json!("203.0.113.8");
  let c=build(vec![a,b],&json!({})).unwrap();
  assert_eq!(c["outbounds"].as_array().unwrap().len(),5);
 }
 #[test] fn reject_unsafe_settings(){
  assert!(validate_settings(&json!({"route":[{"outboundTag":"direct"}]})).is_err());
  assert!(validate_settings(&json!({"dns":"cloudflare","smart":true})).is_ok());
  assert!(validate_settings(&json!({"balance":"unavailable"})).is_err());
 }
 #[test] fn reject_same_local_ports(){
  assert!(build(vec![outbound("RU")],&json!({"subscriptionJson":{
   "socksPort":10808,"httpPort":10808}})).is_err());
 }
}
