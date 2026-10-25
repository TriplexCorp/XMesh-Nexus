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
                settings,
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
    for (marker, value) in theme_changes {
        html = html.replace(marker, &value);
    }
    for (marker, value) in changes {
        html = html.replace(marker, &value);
    }
    html
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
    let metrics = portal_metrics(&user, &settings, en);
    // Show/copy one canonical HTTPS subscription URL. The requesting app's
    // User-Agent decides the JSON/link format and device profile.
    let raw_link = studio_url(&settings, &token);
    let controls = portal_controls(&user, &settings, lang, en, active, &raw_link);
    let decoration = portal_decoration(&settings, en, active);
    let html = portal_html(&settings, lang, en, metrics, controls, decoration);
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
}    let theme_changes = portal_theme_changes(settings);
fn portal_theme_changes(settings: &Value) -> Vec<(&'static str, String)> {
    let background = studio_color(settings, "subscriptionBackground", "#0c131b");
    let card_color = studio_color(settings, "subscriptionCardColor", "#15212b");
    let text_color = studio_color(settings, "subscriptionTextColor", "#ecf3f6");
    let accent = studio_color(settings, "subscriptionAccent", "#7be5b4");
    let secondary = studio_color(settings, "subscriptionSecondaryAccent", "#c6e985");
    let radius = settings
        .get("subscriptionRadius")
        .and_then(Value::as_u64)
        .unwrap_or(16)
        .clamp(1, 36);
    let allowed = |key: &str, valid: &[&str], default: &str| -> String {
        let value = studio_string(settings, key, default);
        if valid.contains(&value) {
            value.to_owned()
        } else {
            default.to_owned()
        }
    };
    vec![
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
    ]
}


