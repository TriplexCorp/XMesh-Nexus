// Real process integration fixtures. Executed only by the disposable Docker harness.
mod signer_e2e {
    use super::*;
    use crate::xsp_v2_signer::issue_or_recover_via_socket;
    use std::os::unix::fs::{PermissionsExt, chown};
    use std::{env, fs, path::PathBuf};

    fn required(name: &str) -> String {
        assert_eq!(
            env::var("XSP_V2_SIGNER_E2E").as_deref(),
            Ok("1"),
            "disposable harness required"
        );
        env::var(name).expect("required E2E configuration missing")
    }

    #[expect(
        clippy::too_many_lines,
        reason = "real signed committed ACK fixture for isolated process E2E"
    )]
    #[tokio::test]
    #[ignore = "requires disposable signer integration harness"]
    async fn prepare_signer_e2e_fixture() {
        let pool = sqlx::PgPool::connect(&required("XSP_V2_TEST_DATABASE_URL"))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT current_database()")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "xmesh"
        );
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let node: u64 = env::var("XSP_V2_E2E_NODE").map_or(912_345_678_979, |value| {
            value.parse().expect("invalid fixture Node ID")
        });
        let node_id = i64::try_from(node).unwrap();
        let owner = "ci-signed-owner";
        let (_old_ed, _old_pq, old_pin) =
            key_pair(21, 22, "node_request", &format!("node-{node}"), node);
        let (next_ed, next_pq, next_pin) =
            key_pair(23, 24, "node_request", &format!("node-{node}"), node);
        let (panel_ed, panel_pq, panel_pin) =
            key_pair(25, 26, "panel_response", "ci-pinned-panel", node);
        // Signing private keys only exist in this disposable CI test process.
        let material = crate::xsp_v2_candidate_binding::CandidatePublic {
            node_id: node,
            from_epoch: 1,
            to_epoch: 2,
            purpose: "node_request".into(),
            from_ed_key_id: old_pin.ed_key_id.clone(),
            from_pq_key_id: old_pin.pq_key_id.clone(),
            to_ed_key_id: next_pin.ed_key_id.clone(),
            to_pq_key_id: next_pin.pq_key_id.clone(),
            active_ed_public: old_pin.ed_public.clone(),
            active_pq_public: old_pin.pq_public.clone(),
            pending_ed_public: next_pin.ed_public.clone(),
            pending_pq_public: next_pin.pq_public.clone(),
        };
        let candidate_hash =
            hex::encode(crate::xsp_v2_candidate_binding::candidate_sha256(&material).unwrap());
        // A fresh throwaway service DB is required; never operate on a real VPS.
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO node_metric_keys(node_id,public_key) VALUES($1,$2)")
            .bind(node_id)
            .bind(hex::encode(Sha256::digest(node.to_be_bytes())))
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO node_xsp_suite_state(node_id,minimum_suite,activation_phase,key_epoch)
             VALUES($1,1,'dual_enrolled',1)",
        )
        .bind(node_id)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO node_xsp_public_keysets
             (node_id,purpose,key_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,mldsa65_public)
             VALUES($1,'node_request',1,$2,$3,$4,$5)",
        )
        .bind(node_id)
        .bind(&old_pin.ed_key_id)
        .bind(&old_pin.pq_key_id)
        .bind(&old_pin.ed_public)
        .bind(&old_pin.pq_public)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO node_xsp_rotation_preparations
             (node_id,from_epoch,to_epoch,ed25519_key_id,mldsa65_key_id,ed25519_public,
              mldsa65_public,challenge_sha256,approved_by,expires_at,proved_at)
             VALUES($1,1,2,$2,$3,$4,$5,decode(repeat('55',32),'hex'),$6,
                    NOW()+INTERVAL '9 minutes',NOW())",
        )
        .bind(node_id)
        .bind(&next_pin.ed_key_id)
        .bind(&next_pin.pq_key_id)
        .bind(&next_pin.ed_public)
        .bind(&next_pin.pq_public)
        .bind(owner)
        .execute(&mut *tx)
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let now = i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
        let fixture: ContractFixture = serde_json::from_str(include_str!(
            "../../docs/XSP_V2_CUTOVER_CONTRACT_VECTORS.json"
        ))
        .unwrap();
        let mut permit = fixture.permit;
        permit.kind = "permit".into();
        permit.issuer_id = panel_pin.issuer_id.clone();
        permit.signer_ed_key_id = panel_pin.ed_key_id.clone();
        permit.signer_pq_key_id = panel_pin.pq_key_id.clone();
        permit.node_id = node;
        permit.from_epoch = 1;
        permit.to_epoch = 2;
        permit.request_id = "ci-real-socket-ack-1".into();
        permit.from_ed_key_id = old_pin.ed_key_id.clone();
        permit.from_pq_key_id = old_pin.pq_key_id.clone();
        permit.to_ed_key_id = next_pin.ed_key_id.clone();
        permit.to_pq_key_id = next_pin.pq_key_id.clone();
        permit.method = "POST".into();
        permit.path = "/api/v2/node/keys/rotation/permit".into();
        permit.issued_at_ms = now - 2000;
        permit.expires_at_ms = now + 50_000;
        permit.permit_nonce_hex = "17".repeat(16);
        permit.nonce_hex = permit.permit_nonce_hex.clone();
        permit.candidate_sha256_hex = candidate_hash;
        permit.permit_sha256_hex = "00".repeat(32);
        permit.applied_state_sha256_hex = "00".repeat(32);
        let signed_permit = sign_staging_permit(&permit, &panel_pin, &panel_ed, &panel_pq).unwrap();
        let mut issue_tx = pool.begin().await.unwrap();
        let stored = crate::xsp_v2_permit_ledger_writer::persist_verified_permit(
            &mut issue_tx,
            node_id,
            owner,
            &permit.request_id,
            &signed_permit,
            &panel_pin,
            now,
        )
        .await
        .expect("real dual-signed permit persisted against approved locked DB keys");
        assert!(!stored.reused);
        assert_eq!(stored.signed_bytes, signed_permit);
        issue_tx.commit().await.unwrap();

        let mut ack = fixture.ack;
        ack.kind = "ack".into();
        ack.issuer_id = format!("node-{node}");
        ack.signer_ed_key_id = next_pin.ed_key_id.clone();
        ack.signer_pq_key_id = next_pin.pq_key_id.clone();
        ack.node_id = node;
        ack.from_epoch = 1;
        ack.to_epoch = 2;
        ack.request_id = permit.request_id.clone();
        ack.from_ed_key_id = old_pin.ed_key_id.clone();
        ack.from_pq_key_id = old_pin.pq_key_id.clone();
        ack.to_ed_key_id = next_pin.ed_key_id.clone();
        ack.to_pq_key_id = next_pin.pq_key_id.clone();
        ack.method = "POST".into();
        ack.path = "/api/v2/node/keys/rotation/ack".into();
        ack.issued_at_ms = now - 1000;
        ack.expires_at_ms = now + 50_000;
        ack.permit_nonce_hex = permit.permit_nonce_hex.clone();
        ack.nonce_hex = "28".repeat(16);
        ack.candidate_sha256_hex = permit.candidate_sha256_hex.clone();
        ack.permit_sha256_hex = digest(&signing_input(&permit).unwrap());
        ack.applied_state_sha256_hex = state_digest(&ack).unwrap();
        let signed_ack = signed_with(&ack, &next_ed, &next_pq);

        crate::xsp_v2_ack_epoch_commit::commit_fresh_applied_ack_staging(
            &pool,
            node_id,
            &permit.request_id,
            &signed_ack,
            &panel_pin,
            now,
        )
        .await
        .unwrap();
        let keys = PathBuf::from(required("XSP_V2_E2E_KEYS"));
        let ed_pem =
            PKey::private_key_from_raw_bytes(&panel_ed.to_bytes(), openssl::pkey::Id::ED25519)
                .unwrap()
                .private_key_to_pem_pkcs8()
                .unwrap();
        for (name, pem) in [
            ("panel-ed25519.pem", ed_pem),
            (
                "panel-mldsa65.pem",
                panel_pq.private_key_to_pem_pkcs8().unwrap(),
            ),
        ] {
            let path = keys.join(name);
            fs::write(&path, pem).unwrap();
            chown(&path, Some(0), Some(10_001)).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o440)).unwrap();
        }
        let document = serde_json::json!({
            "nodeId": node_id, "requestId": permit.request_id,
            "ack": STANDARD.encode(signed_ack),
            "issuer": panel_pin.issuer_id, "edId": panel_pin.ed_key_id, "pqId": panel_pin.pq_key_id,
            "edPublic": STANDARD.encode(panel_pin.ed_public), "pqPublic": STANDARD.encode(panel_pin.pq_public),
        });
        let path = PathBuf::from(required("XSP_V2_E2E_PUBLIC")).join("fixture.json");
        fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    fn fixture() -> (i64, String, Vec<u8>, TrustedPublic) {
        let doc: serde_json::Value = serde_json::from_slice(
            &fs::read(PathBuf::from(required("XSP_V2_E2E_PUBLIC")).join("fixture.json")).unwrap(),
        )
        .unwrap();
        let node = doc["nodeId"].as_i64().unwrap();
        let string = |key: &str| doc[key].as_str().unwrap().to_owned();
        let pin = TrustedPublic {
            purpose: "panel_response".into(),
            issuer_id: string("issuer"),
            node_id: u64::try_from(node).unwrap(),
            ed_key_id: string("edId"),
            pq_key_id: string("pqId"),
            ed_public: STANDARD.decode(string("edPublic")).unwrap(),
            pq_public: STANDARD.decode(string("pqPublic")).unwrap(),
        };
        (
            node,
            string("requestId"),
            STANDARD.decode(string("ack")).unwrap(),
            pin,
        )
    }

    #[tokio::test]
    #[ignore = "requires disposable signer integration harness"]
    async fn api_socket_round_trip_and_concurrent_retry() {
        assert!(
            !std::path::Path::new("/run/xmesh-signer-keys/panel-ed25519.pem").exists()
                && !std::path::Path::new("/run/xmesh-signer-keys/panel-mldsa65.pem").exists(),
            "API must not mount signer keys"
        );
        let pool = sqlx::PgPool::connect(&required("XSP_V2_TEST_DATABASE_URL"))
            .await
            .unwrap();
        let (node, request, ack, pin) = fixture();
        let socket = PathBuf::from(required("XSP_V2_SIGNER_SOCKET_PATH"));
        let (one, two) = tokio::join!(
            issue_or_recover_via_socket(&pool, node, &request, &ack, &pin, &socket),
            issue_or_recover_via_socket(&pool, node, &request, &ack, &pin, &socket)
        );
        // A race may fail closed at the signer existence guard. Retrying must
        // recover the winner rather than replace it or advance the epoch.
        assert!(
            one.is_ok() || two.is_ok(),
            "at least one concurrent request must persist"
        );
        let saved = issue_or_recover_via_socket(&pool, node, &request, &ack, &pin, &socket)
            .await
            .unwrap();
        for result in [one, two].into_iter().flatten() {
            assert_eq!(result, saved);
        }
        let evidence = crate::xsp_v2_ack_epoch_commit::readback_committed_applied_ack_staging(
            &pool, node, &request, &ack, &pin,
        )
        .await
        .unwrap();
        crate::xsp_v2_commit_receipt::verify_staging_commit_receipt(&saved, &pin, &evidence)
            .unwrap();
        let mut different = ack.clone();
        different.push(b' ');
        assert!(
            issue_or_recover_via_socket(&pool, node, &request, &different, &pin, &socket)
                .await
                .is_err()
        );
        assert!(
            issue_or_recover_via_socket(&pool, node, "different-request", &ack, &pin, &socket)
                .await
                .is_err()
        );
        assert!(
            issue_or_recover_via_socket(&pool, node + 1, &request, &ack, &pin, &socket)
                .await
                .is_err()
        );
        let missing = socket.with_file_name("unavailable.sock");
        assert_eq!(
            issue_or_recover_via_socket(&pool, node, &request, &ack, &pin, &missing)
                .await
                .unwrap(),
            saved
        );
        let (epoch,count): (i64,i64) = sqlx::query_as("SELECT key_epoch,(SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id=$1) FROM node_xsp_suite_state WHERE node_id=$1")
            .bind(node).fetch_one(&pool).await.unwrap();
        assert_eq!((epoch, count), (2, 1));
        println!(
            "PASS: separate signer socket, both signatures, concurrent retry, immutable exact bytes, unavailable signer recovery and unchanged epoch"
        );
    }
    #[tokio::test]
    #[ignore = "requires disposable signer integration harness"]
    async fn api_recovery_must_fail_closed() {
        let pool = sqlx::PgPool::connect(&required("XSP_V2_TEST_DATABASE_URL"))
            .await
            .unwrap();
        let (node, request, ack, pin) = fixture();
        let missing = PathBuf::from(required("XSP_V2_SIGNER_SOCKET_PATH"));
        assert!(
            issue_or_recover_via_socket(&pool, node, &request, &ack, &pin, &missing)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    #[ignore = "requires disposable signer integration harness"]
    async fn api_epoch_race_must_not_persist() {
        let pool = sqlx::PgPool::connect(&required("XSP_V2_TEST_DATABASE_URL"))
            .await
            .unwrap();
        let (node, request, ack, pin) = fixture();
        let socket = PathBuf::from(required("XSP_V2_SIGNER_SOCKET_PATH"));
        let result = crate::xsp_v2_signed_receipt_outbox::issue_or_recover_signed_receipt_staging(
            &pool,
            node,
            &request,
            &ack,
            &pin,
            |_| async {
                let signed =
                    crate::xsp_v2_signer::request_receipt_for_test(&socket, node, &request, &ack)
                        .await?;
                let evidence =
                    crate::xsp_v2_ack_epoch_commit::readback_committed_applied_ack_staging(
                        &pool, node, &request, &ack, &pin,
                    )
                    .await?;
                crate::xsp_v2_commit_receipt::verify_staging_commit_receipt(
                    &signed, &pin, &evidence,
                )
                .map_err(anyhow::Error::msg)?;
                // Deterministic race: a real valid signer result exists, then
                // another transition commits before the API's durable insert.
                sqlx::query("UPDATE node_xsp_suite_state SET key_epoch=3 WHERE node_id=$1")
                    .bind(node)
                    .execute(&pool)
                    .await?;
                Ok(signed)
            },
        )
        .await;
        assert!(
            result.is_err(),
            "stale signer evidence must never become a receipt"
        );
        let (epoch,count): (i64,i64) = sqlx::query_as("SELECT key_epoch,(SELECT count(*) FROM node_xsp_signed_commit_receipt_outbox WHERE node_id=$1) FROM node_xsp_suite_state WHERE node_id=$1")
            .bind(node).fetch_one(&pool).await.unwrap();
        assert_eq!((epoch, count), (3, 0));
    }
}
