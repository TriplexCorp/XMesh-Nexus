#!/usr/bin/env python3
"""Disposable two-node signed API + real Node guard + PostgreSQL quota-v2 test.

This does NOT execute real Xray traffic or systemd. It exercises actual
production Nexus endpoints, Ed25519 authentication, per-node guard decisions
and persistent PostgreSQL ledgers with independent node identities.
"""
import copy, hashlib, importlib.util, json, os, subprocess, tempfile, time, uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE=os.environ["XMESH_TEST_URL"].rstrip("/")
assert BASE=="http://127.0.0.1:8080" and os.environ["XMESH_AUDIT_DISPOSABLE"]=="1"
assert os.environ["COMPOSE_PROJECT_NAME"]=="xmesh-quota-v2"
SOURCE=Path(__file__).resolve().parents[1]/"node-agent/deploy/xmesh-policy-guard-base.py"
spec=importlib.util.spec_from_file_location("xmesh_quota_v2_real_guard",SOURCE)
guard=importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
MIB=1024*1024

def api(method,path,data=None,cookie=None,headers=None):
    raw=json.dumps(data,separators=(",",":")).encode() if data is not None else None
    hdr={"Accept":"application/json",**(headers or {})}
    if raw is not None: hdr["Content-Type"]="application/json"
    if cookie: hdr["Cookie"]=cookie
    if method in ("POST","PATCH","DELETE"): hdr["Origin"]=BASE
    try:
        resp=urlopen(Request(BASE+"/api/v1"+path,data=raw,headers=hdr,method=method),timeout=30)
    except HTTPError as e:
        resp=e
    with resp:
        blob=resp.read()
        typ=resp.headers.get_content_type()
        parsed=json.loads(blob) if blob and typ=="application/json" else blob.decode()
        cookies=resp.headers.get_all("Set-Cookie",[])
        new_cookie=next((x.split(";",1)[0] for x in cookies if x.startswith("xmesh_session=")),None)
        return resp.status,parsed,new_cookie

def check(code,expected,message):
    assert code==expected,(message,code,expected)
    print("PASS:",message)

def query(db_sql):
    assert all(x not in db_sql for x in ("\\",";","--"))
    p=subprocess.run(["docker","compose","exec","-T","db","sh","-c",
        'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d xmesh'],
        input=db_sql+";",text=True,capture_output=True,timeout=25,check=True)
    return p.stdout.strip()

class SignedNode:
    def __init__(self,node_id,temporary):
        self.id=node_id
        self.file=Path(temporary)/f"node-{node_id}.pem"
        self.message=Path(temporary)/f"message-{node_id}.txt"
        self.stats_at=int(time.time()*1000)
        self.ledger={}
        self.state=Path(temporary)/f"state-{node_id}"
        self.state.mkdir()
        subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",str(self.file)],
                       capture_output=True,check=True)
        self.public=subprocess.check_output(["openssl","pkey","-in",str(self.file),
                                              "-pubout","-outform","DER"])[-32:].hex()

    def post(self,path,body):
        raw=json.dumps(body,separators=(",",":")).encode()
        stamp=int(time.time())
        nonce=os.urandom(16).hex()
        canonical=(f"XMESH1\nPOST\n/api/v1{path}\n{self.id}\n{stamp}\n{nonce}\n"
                   f"{hashlib.sha256(raw).hexdigest()}\n").encode()
        self.message.write_bytes(canonical)
        sig=subprocess.check_output(["openssl","pkeyutl","-sign","-rawin","-inkey",
                                     str(self.file),"-in",str(self.message)]).hex()
        return api("POST",path,body,headers={"X-XMesh-Timestamp":str(stamp),
                   "X-XMesh-Nonce":nonce,"X-XMesh-Signature":sig})

    def desired(self,user_id,total=0,lease=None):
        row={"userId":user_id,"usedBytes":total}
        if lease:
            row.update({k:lease[k] for k in ("epoch","meterEpoch","reservationId")})
        code,data,_=self.post("/node/desired-config",
            {"node_id":self.id,"quotaProtocolVersion":2,"quotaLocalCounters":[row]})
        check(code,200,f"v2 desired-config issued to node {self.id}")
        assert data["policy"]["version"]==2,data
        policy=guard.verify_envelope(data,self.state,self.id,first_contact=True)
        self.state.joinpath("policy-envelope.json").write_text(json.dumps(data))
        return policy,data

    def metrics(self,user_id,total,lease,raw_total=None,include_receipt=True,stop=None):
        self.stats_at=max(self.stats_at+1,int(time.time()*1000))
        body={"node_id":self.id,"userStatsStatus":"verified",
              "userStatsAtMs":self.stats_at,
              "userTraffic":[{"userId":user_id,"uplinkBytes":total if raw_total is None else raw_total,"downlinkBytes":0}],
              "quotaReceipts":[{
                  "userId":user_id,"usedBytes":total,
                  **{k:lease[k] for k in ("epoch","meterEpoch","reservationId")}
              }]}
        if not include_receipt:
            body["quotaReceipts"]=[]
        if stop is not None:
            body["quotaStopReceipts"]=[{"userId":user_id,**stop}]
        return self.post("/metrics/ingest",body)[0]

def main():
    code,data,cookie=api("POST","/auth/login",
        {"username":os.environ["ADMIN_USERNAME"],"password":os.environ["ADMIN_PASSWORD"]})
    check(code,200,"isolated Nexus owner login")
    with tempfile.TemporaryDirectory() as tmp:
        nodes=[]
        for n in range(2):
            code,data,_=api("POST","/collections/nodes",
                {"name":f"Quota-v2 disposable {n}","addr":f"192.0.2.{60+n}"},cookie)
            check(code,201,"create independent signed node")
            node=SignedNode(data["id"],tmp)
            code,_,_=api("POST",f"/nodes/{node.id}/metrics-key",{"publicKey":node.public},cookie)
            check(code,201,"enroll Ed25519 identity")
            nodes.append(node)
        code,profile,_=api("POST","/collections/profiles",{
            "name":"Quota-v2 two node VLESS profile",
            "config":json.dumps({
                "inbounds":[{"tag":"DE_VLESS","listen":"127.0.0.1","port":28401,
                             "protocol":"vless","settings":{"decryption":"none","clients":[]},
                             "streamSettings":{"network":"tcp","security":"none"}}],
                "outbounds":[{"tag":"direct","protocol":"freedom"}],"routing":{"rules":[]}
            })},cookie)
        check(code,201,"create authentic managed VLESS profile")
        code,squad,_=api("POST","/collections/squads",{"name":"Quota-v2 assigned","inb":["DE_VLESS"]},cookie)
        check(code,201,"create assigned Squad")
        for node in nodes:
            code,_,_=api("PATCH",f"/collections/nodes/{node.id}",
                {"profileId":profile["id"],"xrayLocalPort":28401},cookie)
            check(code,200,"bind Xray profile")
        code,user,_=api("POST","/collections/users",{
            "username":"ci_quota_v2_cumulative","squads":[squad["id"]],
            "hold":False,"limit":0.2,"used":0},cookie)
        check(code,201,"create globally limited subscriber")
        uid=user["id"]; key=str(uid)
        code, preflight, _=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"read authenticated v2 revocation preflight")
        assert preflight["state"]=="inactive" and not preflight["canResetNow"],preflight
        code,_,_=api("GET",f"/users/{uid}/quota-v2/revocation")
        check(code,401,"reject unauthenticated revocation preflight")
        a,b=nodes
        def fleet():
            status,data,_=api("GET","/quota-v2/fleet-readiness",cookie=cookie)
            check(status,200,"authorized quota-v2 authenticated Node/gateway fleet readiness")
            assert data["featureEnabled"] is True
            assert data["servingNodes"]==2,data
            assert data["canRefundFromThisPreflight"] is False
            assert data["physicalStopAndFinalMeterVerified"] is False
            assert data["installedAgentVersionAttested"] is False
            return data
        missing=fleet()
        assert not missing["protocolPreflightPassed"] and missing["protocolCompatibleNodes"]==0,missing
        assert all(row["blocker"]=="missing_or_stale_authenticated_request"
                   for row in missing["nodes"]),missing
        code,_,_=api("GET","/quota-v2/fleet-readiness")
        check(code,401,"node protocol readiness is not exposed without an operator session")
        # A fleet still containing an older quota-protocol Node is NOT
        # safe to flip globally. The signed v1 request must fail *before*
        # any grant is created; production rollout needs this preflight.
        for old_proto in (None,1):
            payload={"node_id":a.id,"quotaLocalCounters":[]}
            if old_proto is not None:
                payload["quotaProtocolVersion"]=old_proto
            code,_,_=a.post("/node/desired-config",payload)
            check(code,409,"old Node quota protocol cannot receive any v2 grant")
        assert query("SELECT COUNT(*)::text FROM quota_v2_reservations WHERE user_id="+str(uid))=="0"
        print("PASS: pre-v2 Agent is denied without creating unsafe reservations")
        obsolete=fleet()
        legacy=next(row for row in obsolete["nodes"] if row["nodeId"]==a.id)
        assert legacy["reportedProtocolVersion"]==1 and legacy["recentAuthenticatedRequest"],obsolete
        assert legacy["blocker"]=="legacy_or_missing_protocol_v2",obsolete
        assert obsolete["protocolCompatibleNodes"]==0
        # First request prepares, but cannot activate an unacknowledged
        # offline allowance. Simulate a lost HTTP response from node A:
        # the repeated request without a durable ID must stay unfunded and
        # return the SAME reservation, not create an inaccessible new one.
        prep_a,config_a=a.desired(uid)
        half=fleet()
        assert half["protocolCompatibleNodes"]==0 and not half["protocolPreflightPassed"],half
        row_a=next(row for row in half["nodes"] if row["nodeId"]==a.id)
        assert row_a["blocker"]=="legacy_protocol_seen_recently" and not row_a["legacyQuietPeriodPassed"],half
        prep_b,config_b=b.desired(uid)
        held=fleet()
        assert held["protocolCompatibleNodes"]==1 and not held["protocolPreflightPassed"],held
        assert next(row for row in held["nodes"] if row["nodeId"]==b.id)["protocolPreflightPassed"],held
        # A new v2 request cannot erase evidence of another still-live v1
        # worker. Simulate the completed quiet window in this disposable DB.
        query("UPDATE quota_v2_authenticated_protocol_observations "
              "SET last_legacy_claim_at=NOW()-INTERVAL '16 minutes' "
              "WHERE node_id="+str(a.id))
        compatible=fleet()
        assert compatible["protocolPreflightPassed"] and compatible["protocolCompatibleNodes"]==2,compatible
        assert all(row["legacyQuietPeriodPassed"] for row in compatible["nodes"]),compatible
        assert all(row["signedPolicyServedAfterClaim"] for row in compatible["nodes"]),compatible
        print("PASS: every serving node has recently authenticated protocol v2 and received a policy")
        # A stale-but-once-signed v2 claim is insufficient even if a signed
        # desired policy was issued at some point in the past.
        query("UPDATE quota_v2_authenticated_protocol_observations "
              "SET authenticated_request_at=NOW()-INTERVAL '40 minutes' "
              "WHERE node_id="+str(b.id))
        stale=fleet()
        assert not stale["protocolPreflightPassed"],stale
        assert next(row for row in stale["nodes"] if row["nodeId"]==b.id)["blocker"]=="missing_or_stale_authenticated_request",stale
        refreshed_b,_=b.desired(uid)
        assert refreshed_b["users"][0]["quotaReservation"]["reservationId"]==prep_b["users"][0]["quotaReservation"]["reservationId"]
        assert fleet()["protocolPreflightPassed"]
        print("PASS: stale authenticated Node observation fails closed until another signed policy response")
        # Downgrading one signed node must immediately invalidate the fleet
        # snapshot even if it was compatible a moment ago. A rejected old
        # request MUST NOT mutate existing reservations.
        code,_,_=a.post("/node/desired-config",
             {"node_id":a.id,"quotaProtocolVersion":1,"quotaLocalCounters":[]})
        check(code,409,"authenticated protocol downgrade invalidates fleet readiness")
        downgraded=fleet()
        assert not downgraded["protocolPreflightPassed"],downgraded
        assert next(row for row in downgraded["nodes"] if row["nodeId"]==a.id)["blocker"]=="legacy_or_missing_protocol_v2"
        recovered,_=a.desired(uid)
        assert recovered["users"][0]["quotaReservation"]["reservationId"]==prep_a["users"][0]["quotaReservation"]["reservationId"]
        waiting=fleet()
        assert not waiting["protocolPreflightPassed"],waiting
        row_a=next(row for row in waiting["nodes"] if row["nodeId"]==a.id)
        assert row_a["reportedProtocolVersion"]==2 and row_a["blocker"]=="legacy_protocol_seen_recently",waiting
        # A fresh v2 claim does not prove that the old process has stopped;
        # wait for a full legacy-free window before declaring compatibility.
        query("UPDATE quota_v2_authenticated_protocol_observations "
              "SET last_legacy_claim_at=NOW()-INTERVAL '16 minutes' "
              "WHERE node_id="+str(a.id))
        assert fleet()["protocolPreflightPassed"]
        print("PASS: old-agent quiet window blocks mixed generations without changing reservation")
        # Protocol compatibility alone cannot mean the installed control
        # runtime was recently online. All heartbeat claims below are signed
        # by the correct Ed25519 Node identity, but they are NOT executable
        # attestation or proof that Xray has physically stopped.
        initial_release=fleet()
        assert initial_release["targetAgentVersion"]=="control-v6.0.21",initial_release
        assert initial_release["protocolPreflightPassed"],initial_release
        assert not initial_release["rolloutPreflightPassed"],initial_release
        assert initial_release["agentReleaseCompatibleNodes"]==0,initial_release
        def heartbeat(node,version):
            status,data,_=node.post("/node/heartbeat",{
                "node_id":node.id,"version":version,
                "router_running":True,"xray_running":False
            })
            check(status,200,f"authenticated Node {node.id} heartbeat for {version}")
            assert data["accepted"] is True,data
        heartbeat(a,"control-v6.0.20")
        heartbeat(b,"control-v6.0.21")
        obsolete_agent=fleet()
        assert not obsolete_agent["rolloutPreflightPassed"],obsolete_agent
        outdated=next(row for row in obsolete_agent["nodes"] if row["nodeId"]==a.id)
        assert outdated["agentBlocker"]=="agent_release_version_mismatch",obsolete_agent
        assert outdated["reportedAgentVersion"]=="control-v6.0.20",obsolete_agent
        assert obsolete_agent["agentReleaseCompatibleNodes"]==1,obsolete_agent
        # Upgrading an old worker cannot erase evidence of a second stale
        # worker sharing its Node key. Require 15 minutes without v6.0.20.
        heartbeat(a,"control-v6.0.21")
        mixed=fleet()
        assert mixed["protocolPreflightPassed"] and not mixed["rolloutPreflightPassed"],mixed
        mixed_a=next(row for row in mixed["nodes"] if row["nodeId"]==a.id)
        assert mixed_a["agentBlocker"]=="outdated_agent_seen_recently",mixed
        assert mixed_a["reportedAgentVersion"]=="control-v6.0.21",mixed
        query("UPDATE quota_v2_authenticated_agent_release_observations "
              "SET last_non_target_at=NOW()-INTERVAL '16 minutes' "
              "WHERE node_id="+str(a.id))
        released=fleet()
        assert released["rolloutPreflightPassed"] and released["rolloutCompatibleNodes"]==2,released
        assert all(row["agentReleasePreflightPassed"] for row in released["nodes"]),released
        # Receiving a signed desired-config + a fresh version heartbeat is
        # insufficient to claim Xray ACTUALLY APPLIED that configuration.
        # All prior heartbeats deliberately report xray_running=False.
        assert not released["activationCandidatePreflightPassed"],released
        assert released["applicationCompatibleNodes"]==0,released
        assert all(row["applicationBlocker"]=="xray_not_running"
                   for row in released["nodes"]),released
        def applied_heartbeat(node, revision=None, profile_check="verified", running=True):
            if revision is None:
                revision=query("SELECT revision FROM node_desired_revisions WHERE node_id="+str(node.id))
            assert len(revision)==64 and revision.isalnum(),revision
            status,data,_=node.post("/node/heartbeat",{
                "node_id":node.id,"version":"control-v6.0.21",
                "router_running":True,"xray_running":running,
                "appliedRevision":revision,"profileCheck":profile_check
            })
            check(status,200,"signed runtime application observation")
            assert data["accepted"] is True,data
            return revision
        expected_a=applied_heartbeat(a)
        candidate_one=fleet()
        assert candidate_one["applicationCompatibleNodes"]==1,candidate_one
        assert not candidate_one["activationCandidatePreflightPassed"],candidate_one
        expected_b=applied_heartbeat(b)
        deployed=fleet()
        assert deployed["applicationPreflightPassed"] and deployed["activationCandidatePreflightPassed"],deployed
        assert deployed["activationCandidateNodes"]==2,deployed
        assert all(row["runtimeProfileCheck"]=="verified" and row["xrayRunning"]
                   and row["runtimeHeartbeatAfterDelivery"]
                   and row["reportedAppliedRevision"]==row["lastServedRevision"]
                   for row in deployed["nodes"]),deployed
        # An authenticated worker with a running Xray but a stale applied
        # revision must no longer be presented as a cutover candidate.
        changed_b="f"*64 if expected_b!="f"*64 else "e"*64
        applied_heartbeat(b,changed_b)
        stale_applied=fleet()
        assert stale_applied["rolloutPreflightPassed"] and not stale_applied["activationCandidatePreflightPassed"],stale_applied
        assert next(row for row in stale_applied["nodes"] if row["nodeId"]==b.id)["applicationBlocker"]=="last_served_revision_not_applied",stale_applied
        applied_heartbeat(b,expected_b,"policy_invalid")
        bad_profile=fleet()
        assert not bad_profile["activationCandidatePreflightPassed"],bad_profile
        assert next(row for row in bad_profile["nodes"] if row["nodeId"]==b.id)["applicationBlocker"]=="active_profile_not_verified",bad_profile
        applied_heartbeat(b,expected_b)
        # The report must also reject a same-digest heartbeat that happened
        # BEFORE the server delivered the most recent policy.
        query("UPDATE node_runtime_heartbeats SET received_at=NOW()-INTERVAL '10 seconds' WHERE node_id="+str(b.id))
        query("UPDATE node_desired_revisions SET served_at=NOW() WHERE node_id="+str(b.id))
        premature=fleet()
        assert not premature["activationCandidatePreflightPassed"],premature
        assert next(row for row in premature["nodes"] if row["nodeId"]==b.id)["applicationBlocker"]=="no_application_heartbeat_after_policy_delivery",premature
        applied_heartbeat(b,expected_b)
        assert fleet()["activationCandidatePreflightPassed"],fleet()
        # A stale runtime observation is distinct from the latest Agent
        # release claim. A healthy release heartbeat alone isn't enough.
        query("UPDATE node_runtime_heartbeats SET received_at=NOW()-INTERVAL '120 seconds' WHERE node_id="+str(b.id))
        runtime_stale=fleet()
        assert not runtime_stale["activationCandidatePreflightPassed"],runtime_stale
        assert next(row for row in runtime_stale["nodes"] if row["nodeId"]==b.id)["applicationBlocker"]=="missing_or_stale_authenticated_runtime_heartbeat",runtime_stale
        applied_heartbeat(b,expected_b)
        assert fleet()["activationCandidatePreflightPassed"],fleet()
        print("PASS: cutover application preflight requires running Xray, verified current profile and fresh post-delivery signed heartbeat")
        # A separate 0.1.0 Go router still has a heartbeat; it MUST NOT
        # impersonate or overwrite the control-Agent release observation.
        heartbeat(a,"0.1.0")
        assert fleet()["rolloutPreflightPassed"],fleet()
        # A key from A must not forge a claimed release version of B.
        code,_,_=a.post("/node/heartbeat",{
            "node_id":b.id,"version":"control-v6.0.20",
            "router_running":True,"xray_running":False
        })
        assert code in (401,403),(code,"forged cross-node release heartbeat")
        assert fleet()["rolloutPreflightPassed"],fleet()
        # Even a previously correct signed version becomes untrusted after
        # its short heartbeat TTL; fresh traffic-policy polling is distinct.
        query("UPDATE quota_v2_authenticated_agent_release_observations "
              "SET last_authenticated_at=NOW()-INTERVAL '120 seconds' "
              "WHERE node_id="+str(b.id))
        expired=fleet()
        assert not expired["rolloutPreflightPassed"],expired
        expired_b=next(row for row in expired["nodes"] if row["nodeId"]==b.id)
        assert expired_b["agentBlocker"]=="missing_or_stale_authenticated_agent_heartbeat",expired
        heartbeat(b,"control-v6.0.21")
        assert fleet()["rolloutPreflightPassed"],fleet()
        print("PASS: v6.0.21 release preflight needs fresh signed heartbeats and an old-Agent quiet window")
        # Re-execute the migration's EXACT seed statement in this disposable
        # database with a pre-existing live Agent heartbeat. The backfill
        # must conservatively quarantine even an already-correct v6.0.21
        # report because historical concurrent old workers are unknowable.
        query("DELETE FROM quota_v2_authenticated_agent_release_observations "
              "WHERE node_id="+str(a.id))
        source=Path(__file__).resolve().parents[1]/(
            "backend/migrations/0131_quota_v2_authenticated_agent_release_observations.sql")
        migration_sql=source.read_text(encoding="utf-8")
        prefix="INSERT INTO quota_v2_authenticated_agent_release_observations"
        assert migration_sql.count(prefix)==1,migration_sql
        seed_sql=prefix+migration_sql.split(prefix,1)[1].split(";",1)[0]
        query(seed_sql)
        migrated=fleet()
        assert not migrated["rolloutPreflightPassed"],migrated
        migrated_a=next(row for row in migrated["nodes"] if row["nodeId"]==a.id)
        assert migrated_a["reportedAgentVersion"]=="control-v6.0.21",migrated
        assert migrated_a["agentBlocker"]=="outdated_agent_seen_recently",migrated
        query("UPDATE quota_v2_authenticated_agent_release_observations "
              "SET last_non_target_at=NOW()-INTERVAL '16 minutes' "
              "WHERE node_id="+str(a.id))
        assert fleet()["rolloutPreflightPassed"],fleet()
        print("PASS: migration seeds a conservative Agent quiet window for existing installations")
        lease_pre_a=prep_a["users"][0]["quotaReservation"]
        lease_pre_b=prep_b["users"][0]["quotaReservation"]
        # Execute the actual guard on the prepared signed lease: it MUST
        # persist the durable ID even though its zero ceiling denies access.
        _, prepared_ledger_a, denied = guard.enforce(
            prep_a,config_a["config"],{}, {key:0},"xray-a",False,prep_a["issuedAtMs"])
        assert denied.get(prep_a["users"][0]["xrayId"])=="quota", denied
        _, prepared_ledger_b, denied = guard.enforce(
            prep_b,config_b["config"],{}, {key:0},"xray-b",False,prep_b["issuedAtMs"])
        assert denied.get(prep_b["users"][0]["xrayId"])=="quota", denied
        assert prepared_ledger_a["users"][key]["quotaReservation"]["reservationId"]==lease_pre_a["reservationId"]
        assert prepared_ledger_b["users"][key]["quotaReservation"]["reservationId"]==lease_pre_b["reservationId"]
        assert lease_pre_a["ceilingBytes"]==lease_pre_a["acknowledgedBytes"]==0
        assert lease_pre_b["ceilingBytes"]==lease_pre_b["acknowledgedBytes"]==0
        retry_a,_=a.desired(uid)
        lease_retry=retry_a["users"][0]["quotaReservation"]
        assert lease_retry["reservationId"]==lease_pre_a["reservationId"]
        assert lease_retry["ceilingBytes"]==0
        print("PASS: lost first response recovers unchanged unfunded signed lease")
        # The real danger is two DIFFERENT nodes trying to reserve the
        # same remaining paid bytes at precisely the same time. Earlier
        # versions of this acceptance test called A then B serially and
        # could not detect a race in the per-user allocation serializer.
        # Keep each Node's own Ed25519 signing file and committed policy
        # independent; a barrier releases both real HTTP requests together.
        def concurrent_desired(requests):
            start=threading.Barrier(len(requests),timeout=20)
            def invoke(node,total,lease):
                start.wait(timeout=20)
                return node.desired(uid,total,lease)
            with ThreadPoolExecutor(max_workers=len(requests)) as pool:
                futures=[pool.submit(invoke,*request) for request in requests]
                return [future.result(timeout=50) for future in futures]
        (pa,da),(pb,db)=concurrent_desired([
            (a,0,prepared_ledger_a["users"][key]["quotaReservation"]),
            (b,0,prepared_ledger_b["users"][key]["quotaReservation"])
        ])
        lease_a=pa["users"][0]["quotaReservation"]
        lease_b=pb["users"][0]["quotaReservation"]
        assert lease_a["reservationId"]!=lease_b["reservationId"]
        assert lease_a["ceilingBytes"]>0 and lease_b["ceilingBytes"]>0
        # A lost funded journal cannot be silently replaced: an active grant
        # may already have been spent offline.
        code, _, _ = a.post("/node/desired-config",{
            "node_id":a.id,"quotaProtocolVersion":2,"quotaLocalCounters":[]})
        check(code,409,"reject missing durable journal after funded reservation")
        def account():
            return tuple(map(int,query(
                "SELECT settled_bytes||','||"
                "(SELECT COALESCE(SUM(ceiling_bytes-GREATEST(acknowledged_bytes,conservative_burn_floor_bytes)),0)"
                " FROM quota_v2_reservations WHERE user_id="+str(uid)+")||','||limit_bytes"
                " FROM quota_v2_accounts WHERE user_id="+str(uid)+" AND NOT closed"
            ).split(",")))
        settled,held,limit=account()
        assert settled==0 and held==lease_a["ceilingBytes"]+lease_b["ceilingBytes"]
        assert settled+held<=limit,(settled,held,limit)
        # Replay two signed funded policies concurrently. Missing HTTP
        # acknowledgements must not mint a second lease, extend a grant
        # twice, or mutate the globally held balance.
        before_replay=(settled,held,limit)
        (retry_pa,_),(retry_pb,_)=concurrent_desired([
            (a,0,lease_a),(b,0,lease_b)
        ])
        for previous,repeated in ((lease_a,retry_pa),(lease_b,retry_pb)):
            same=repeated["users"][0]["quotaReservation"]
            assert same["reservationId"]==previous["reservationId"],(previous,same)
            assert same["epoch"]==previous["epoch"] and same["meterEpoch"]==previous["meterEpoch"]
            assert same["ceilingBytes"]==previous["ceilingBytes"],(previous,same)
        assert account()==before_replay,(before_replay,account())
        print("PASS: parallel signed first-grant and lost-response retry conserve global quota")
        code, preflight, _=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"show active signed holds across both nodes")
        assert preflight["state"]=="awaiting_nodes" and not preflight["canResetNow"],preflight
        assert preflight["heldBytes"]==held and preflight["expirationRefundsBudget"] is False
        assert {row["nodeId"] for row in preflight["nodes"]}=={a.id,b.id}
        assert all(row["heldBytes"]>0 and row["nodeConfirmed"] for row in preflight["nodes"])
        print("PASS: revocation preflight identifies each node holding offline bytes")
        # Resetting only UI usage while a signed offline lease is outstanding
        # would grant fresh bytes without revoking the old policy on node B.
        before_reset = account()
        code, reset_body, _ = api("PATCH", f"/collections/users/{uid}",
                                  {"used": 0}, cookie)
        check(code, 409, "reject user meter reset while v2 leases remain signed")
        assert account() == before_reset, (before_reset, account())
        assert isinstance(reset_body, dict) and "резерв" in str(reset_body).lower()
        print("PASS: admin reset leaves active v2 epoch and reservations unchanged")

        # Real admission decisions against independently persisted in-memory
        # ledgers (same guard used by Node service; actual signed policies).
        _,a.ledger,denied=guard.enforce(pa,da["config"],prepared_ledger_a,
                                         {key:0},"xray-a",False,pa["issuedAtMs"])
        assert not denied,denied
        _,b.ledger,denied=guard.enforce(pb,db["config"],prepared_ledger_b,
                                         {key:0},"xray-b",False,pb["issuedAtMs"])
        assert not denied,denied
        _,a.ledger,denied=guard.enforce(pa,da["config"],a.ledger,
                                         {key:40*MIB},"xray-a",True,pa["issuedAtMs"]+10)
        assert not denied,denied
        _,b.ledger,denied=guard.enforce(pb,db["config"],b.ledger,
                                         {key:10*MIB},"xray-b",True,pb["issuedAtMs"]+10)
        assert not denied,denied
        saved_a = copy.deepcopy(a.ledger)
        check(b.metrics(uid,0,lease_b),201,"node B first verified baseline")
        check(b.metrics(uid,10*MIB,lease_b),201,"node B partial receipt accepted")
        check(b.metrics(uid,10*MIB,lease_b),201,"node B duplicate cumulative receipt is idempotent")
        settled,held,limit=account()
        assert settled==10*MIB and settled+held<=limit,(settled,held,limit)
        print("PASS: only reporting node's receipt is settled exactly once")

        # A did not report; B's update cannot change A's held ceiling.
        still_a=query("SELECT ceiling_bytes::text FROM quota_v2_reservations WHERE user_id="
                      +str(uid)+" AND node_id="+str(a.id))
        assert int(still_a)==lease_a["ceilingBytes"],(still_a,lease_a)
        _,a.ledger,denied=guard.enforce(pa,da["config"],a.ledger,
                   {key:lease_a["ceilingBytes"]},"xray-a",True,pa["issuedAtMs"]+20)
        assert denied.get(pa["users"][0]["xrayId"])=="quota",denied
        print("PASS: node A cuts off at original signed ceiling after only B reconnects")

        # Node A signs its own durable 40 MiB for desired-config; the server can
        # acknowledge it once, but may grant more only from unheld global quota.
        # Restore the independent 40 MiB journal before the separate cutoff
        # branch; copying only total would leave the raw Xray baseline at 64 MiB.
        a.ledger=saved_a
        time.sleep(.02)
        pa2,da2=a.desired(uid,40*MIB,lease_a)
        # Reconciliation can extend node A's absolute ceiling using only
        # still-unreserved global capacity. From this point forward use the
        # latest signed revision, not A's original earlier grant.
        lease_a=pa2["users"][0]["quotaReservation"]
        settled,held,limit=account()
        assert settled==50*MIB and settled+held<=limit,(settled,held,limit)
        _,a.ledger,denied=guard.enforce(pa2,da2["config"],a.ledger,
                                          {key:40*MIB},"xray-a",False,pa2["issuedAtMs"])
        assert not denied,denied
        print("PASS: authenticated A reconciliation preserves conservation")

        # A's identity cannot claim node B's lease.
        c,_,_=a.post("/metrics/ingest",{
            "node_id":a.id,"userStatsStatus":"verified",
            "userStatsAtMs":int(time.time()*1000)+1,
            "userTraffic":[{"userId":uid,"uplinkBytes":40*MIB,"downlinkBytes":0}],
            "quotaReceipts":[{"userId":uid,"usedBytes":10*MIB,**{
                k:lease_b[k] for k in ("epoch","meterEpoch","reservationId")}}]})
        assert c in (400,403,409),("cross-node receipt accepted",c)
        assert account()[0]==50*MIB
        print("PASS: cross-node receipt substitution rejected without mutation")

        # A quota decrease cannot invalidate an active offline reservation.
        code, _, _=api("PATCH",f"/collections/users/{uid}",{"limit":0},cookie)
        check(code,409,"cannot turn signed limited plan unlimited during unsafe fleet transition")
        code, _, _=api("PATCH",f"/collections/users/{uid}",{"limit":0.01},cookie)
        check(code,409,"cannot lower plan beneath already consumed and reserved bytes")
        assert account()[2]==limit

        # Drain each node's actual signed allowance. Nothing may be refunded
        # solely because a 24h lease expires, and no new epoch is allowed until
        # the authenticated absolute receipts have settled every old ceiling.
        _,a.ledger,denied=guard.enforce(
            pa2,da2["config"],a.ledger,{key:lease_a["ceilingBytes"]},
            "xray-a",True,pa2["issuedAtMs"]+25)
        assert denied.get(pa2["users"][0]["xrayId"])=="quota",denied
        _,b.ledger,denied=guard.enforce(
            pb,db["config"],b.ledger,{key:lease_b["ceilingBytes"]},
            "xray-b",True,pb["issuedAtMs"]+25)
        assert denied.get(pb["users"][0]["xrayId"])=="quota",denied
        check(a.metrics(uid,0,lease_a),201,"node A verified meter baseline before full drain")
        check(a.metrics(uid,lease_a["ceilingBytes"],lease_a),201,"node A fully spends and settles old allowance")
        check(b.metrics(uid,lease_b["ceilingBytes"],lease_b),201,"node B fully spends and settles old allowance")
        settled,held,limit=account()
        assert held==0 and settled==lease_a["ceilingBytes"]+lease_b["ceilingBytes"]
        print("PASS: all old signed spending obligations settled before reset")
        code, preflight, _=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"show fully drained reservation readiness")
        assert preflight["state"]=="drained" and preflight["canResetNow"]
        assert preflight["heldBytes"]==0
        assert all(row["heldBytes"]==0 for row in preflight["nodes"]),preflight
        # Simulate Xray restarting after a durable receipt: the fresh raw
        # counter is zero, while the signed Node journal remains cumulative.
        check(a.metrics(uid,lease_a["ceilingBytes"],lease_a,raw_total=0),201,
              "restart raw Xray meter without resetting durable signed receipt")
        _,a.ledger,denied=guard.enforce(
            pa2,da2["config"],a.ledger,{key:0},
            "xray-restarted-a",True,pa2["issuedAtMs"]+30)
        assert denied.get(pa2["users"][0]["xrayId"])=="quota-meter-continuity-lost",denied
        assert a.ledger["users"][key]["quotaMeterContinuityLost"]["reason"] == "unverified-xray-runtime-transition"
        print("PASS: restart latches unverified old-runtime byte interval without issuing capacity")

        code,reset_body,_=api("PATCH",f"/collections/users/{uid}",{"used":0},cookie)
        check(code,200,"atomically reset user traffic after old v2 leases drain")
        assert reset_body["used"]==0,reset_body
        assert query("SELECT COUNT(*)::text FROM quota_v2_accounts WHERE user_id="+str(uid)+" AND closed")=="1"
        assert query("SELECT COUNT(*)::text FROM quota_v2_accounts WHERE user_id="+str(uid)+" AND NOT closed")=="0"
        print("PASS: drained epoch is closed with no automatic refund")

        time.sleep(0.03)
        # A Node continues using its durable absolute counter. New epoch
        # inherits meterEpoch but MUST get a new reservationId and start
        # unfunded (ceiling equals the old local absolute counter).
        staged_a,sa=a.desired(uid,lease_a["ceilingBytes"],lease_a)
        staged_b,sb=b.desired(uid,lease_b["ceilingBytes"],lease_b)
        new_a=staged_a["users"][0]["quotaReservation"]
        new_b=staged_b["users"][0]["quotaReservation"]
        assert new_a["epoch"]!=lease_a["epoch"]
        assert new_a["epoch"]==new_b["epoch"]
        assert new_a["meterEpoch"]==lease_a["meterEpoch"]
        assert new_a["reservationId"]!=lease_a["reservationId"]
        assert new_a["ceilingBytes"]==new_a["acknowledgedBytes"]==lease_a["ceilingBytes"]
        assert new_b["ceilingBytes"]==new_b["acknowledgedBytes"]==lease_b["ceilingBytes"]
        # Regression: a legacy/interrupted CLOSED epoch can still contain
        # spendable signed capacity even though the current epoch is already
        # zero-grant. Such debt MUST block admin reset, not be silently
        # omitted by a current-epoch-only reservation query.
        old_epoch=lease_a["epoch"]
        prior_ceiling=int(query(
            "SELECT ceiling_bytes::text FROM quota_v2_reservations WHERE user_id="
            +str(uid)+" AND node_id="+str(a.id)+" AND epoch='"+old_epoch+"'"))
        previous_ack=int(query(
            "SELECT acknowledged_bytes::text FROM quota_v2_reservations WHERE user_id="
            +str(uid)+" AND node_id="+str(a.id)+" AND epoch='"+old_epoch+"'"))
        assert prior_ceiling==previous_ack
        assert query(
            "SELECT closed::text FROM quota_v2_accounts WHERE user_id="+str(uid)+
            " AND epoch='"+old_epoch+"'")=="true"
        query(
            "UPDATE quota_v2_reservations SET ceiling_bytes=ceiling_bytes+"+str(20*MIB)+" "
            "WHERE user_id="+str(uid)+" AND node_id="+str(a.id)+
            " AND epoch='"+old_epoch+"'")
        code,historical,_=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"show old-epoch offline debt even when new epoch has zero grant")
        assert historical["state"]=="awaiting_historical" and not historical["canResetNow"],historical
        assert historical["historicalHeldBytes"]==20*MIB and historical["heldBytes"]==20*MIB,historical
        # The Node's ordinary authenticated policy poll must also refuse
        # new signed capacity. Blocking only the UI reset is insufficient:
        # otherwise an existing zero-grant new epoch can mint another grant.
        code,_,_=a.post("/node/desired-config",{
            "node_id":a.id,"quotaProtocolVersion":2,"quotaLocalCounters":[{
                "userId":uid,"usedBytes":lease_a["ceilingBytes"],
                "epoch":new_a["epoch"],"meterEpoch":new_a["meterEpoch"],
                "reservationId":new_a["reservationId"]
            }]
        })
        check(code,409,"refuse signed Node refill while closed epoch holds bytes")
        code,_,_=api("PATCH",f"/collections/users/{uid}",{"limit":0.01},cookie)
        check(code,409,"deny tariff decrease beneath historical node obligation")
        code,_,_=api("PATCH",f"/collections/users/{uid}",{"used":0},cookie)
        check(code,409,"prevent quota reset with outstanding grant in closed epoch")
        assert query("SELECT COUNT(*)::text FROM quota_v2_accounts WHERE user_id="
                     +str(uid)+" AND NOT closed")=="1"
        query(
            "UPDATE quota_v2_reservations SET ceiling_bytes="+str(prior_ceiling)+
            " WHERE user_id="+str(uid)+" AND node_id="+str(a.id)+
            " AND epoch='"+old_epoch+"'")
        code,clean,_=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"preflight recovers when old-epoch liability is fully charged")
        assert clean["historicalHeldBytes"]==0 and clean["canResetNow"],clean
        print("PASS: closed historic reserve cannot mint capacity on later admin reset")

        # Reducing a tariff is allowed once there is no outstanding budget
        # beyond the requested limit; all still-live leases are protected.
        code,_,_=api("PATCH",f"/collections/users/{uid}",{"limit":0.15},cookie)
        check(code,200,"safely decrease quota with no outstanding new-epoch grants")
        check(b.metrics(uid,lease_b["ceilingBytes"],lease_b),201,
              "late duplicate receipt of closed epoch is safe")
        assert account()[0]==0 and account()[1]==0
        _,a.ledger,denied=guard.enforce(
            staged_a,sa["config"],a.ledger,{key:0},
            "xray-restarted-a",False,staged_a["issuedAtMs"])
        assert denied.get(staged_a["users"][0]["xrayId"]) in ("quota","locally-revoked"),denied
        assert "quotaMeterContinuityLost" not in a.ledger["users"][key]
        assert a.ledger["users"][key]["quotaMeterContinuityLastResolved"]["refundableBytes"] == 0
        assert lease_a["epoch"] in a.ledger["users"][key]["quotaRetiredEpochs"]
        print("PASS: signed zero-grant new epoch retires untrusted old meter without refund")

        time.sleep(0.03)
        active_a,aa=a.desired(uid,lease_a["ceilingBytes"],new_a)
        active_b,bb=b.desired(uid,lease_b["ceilingBytes"],new_b)
        grant_a=active_a["users"][0]["quotaReservation"]
        grant_b=active_b["users"][0]["quotaReservation"]
        assert grant_a["ceilingBytes"]>grant_a["acknowledgedBytes"]
        assert grant_b["ceilingBytes"]>grant_b["acknowledgedBytes"]
        settled,held,limit=account()
        assert limit==150_000_000,limit
        assert settled==0 and 0<held<=limit
        _,a.ledger,denied=guard.enforce(
            active_a,aa["config"],a.ledger,{key:0},
            "xray-restarted-a",False,active_a["issuedAtMs"])
        assert not denied,denied
        print("PASS: reset quota issues only a newly acknowledged lease without replaying old traffic")

        # Telemetry and quota receipts are separate signed message fields.
        # A sender may report verified traffic first, before the durable
        # quota receipt catches up; the admin must count that pending usage
        # too when validating a lower quota.
        check(a.metrics(uid,lease_a["ceilingBytes"],grant_a,raw_total=0,include_receipt=False),
              201,"accept signed raw meter baseline before quota receipt")
        check(a.metrics(uid,lease_a["ceilingBytes"],grant_a,raw_total=20*MIB,include_receipt=False),
              201,"record verified user traffic before separate quota receipt")
        settled,held,limit=account()
        assert settled==0 and held>0 and held<140_000_000,(settled,held,limit)
        code,_,_=api("PATCH",f"/collections/users/{uid}",{"limit":0.14},cookie)
        check(code,409,"deny quota decrease using verified traffic even before signed receipt")
        assert account()==(settled,held,limit)
        print("PASS: quota reduction charges pending verified telemetry plus outstanding holds")

        # Operator issues a durable, idempotent stop intent scoped to A's
        # current signed grant. Until physical Xray stop is proven, both
        # nodes' remaining spending allowances are still fully held.
        reserved_before=account()
        body={"nodeId":a.id}
        code, intent, _=api("POST",f"/users/{uid}/quota-v2/revocation",body,cookie)
        check(code,202,"start a lease-bound revocation with NO refunded bytes")
        assert intent["state"]=="pending_node_stop" and intent["refundedBytes"]==0,intent
        code, repeated, _=api("POST",f"/users/{uid}/quota-v2/revocation",body,cookie)
        check(code,202,"repeat the same intent idempotently")
        assert repeated["requestId"]==intent["requestId"],(repeated,intent)
        assert account()==reserved_before
        time.sleep(0.03)
        stopped,stop_doc=a.desired(uid,lease_a["ceilingBytes"],grant_a)
        deny=stopped["users"][0]["quotaRevocation"]
        assert deny["requestId"]==intent["requestId"]
        assert deny["epoch"]==intent["epoch"]
        assert deny["reservationId"]==intent["reservationId"]
        # Revocation may be delivered over multiple signed polls. Each
        # revocation policy MUST retain the last already-issued lease expiry
        # and cannot create fresh spendable bytes while the Node is offline.
        revoked_lease=stopped["users"][0]["quotaReservation"]
        assert revoked_lease["validUntilMs"]==grant_a["validUntilMs"],(revoked_lease,grant_a)
        assert revoked_lease["ceilingBytes"]==grant_a["ceilingBytes"],(revoked_lease,grant_a)
        time.sleep(0.03)
        stopped_again,stop_doc_again=a.desired(uid,lease_a["ceilingBytes"],revoked_lease)
        repeated_lease=stopped_again["users"][0]["quotaReservation"]
        assert repeated_lease["validUntilMs"]==grant_a["validUntilMs"],repeated_lease
        assert repeated_lease["ceilingBytes"]==grant_a["ceilingBytes"],repeated_lease
        assert stopped_again["users"][0]["quotaRevocation"]["requestId"]==intent["requestId"]
        stopped,stop_doc=stopped_again,stop_doc_again
        print("PASS: repeated signed revoke never renews node lease or grants bytes")
        effective,a.ledger,blocked=guard.enforce(
            stopped,stop_doc["config"],a.ledger,{key:0},
            "xray-restarted-a",False,stopped["issuedAtMs"])
        assert blocked.get(stopped["users"][0]["xrayId"])=="quota-revocation-pending",blocked
        assert not effective["inbounds"][0]["settings"]["clients"]
        # This is a *prepared* decision only; no refund before a separate
        # verified runtime stop proof and final durable meter. The signed
        # desired-config may simultaneously settle A's previously unreported
        # usage, moving bytes from held to settled without freeing capacity.
        settled_after,held_after,limit_after=account()
        spent_before,held_before,limit_before=reserved_before
        assert limit_after==limit_before
        assert settled_after>=spent_before
        assert settled_after+held_after==spent_before+held_before
        # An actual Node Agent calls the guard's commit only after Docker
        # applies Xray's verified config and its public router reconciles.
        # Never acknowledge a prepared denial that still contains the user.
        with_credential=copy.deepcopy(stop_doc["config"])
        try:
            guard.applied_revocation_proofs(stopped,with_credential,copy.deepcopy(a.ledger))
        except ValueError:
            pass
        else:
            raise AssertionError("prepared policy was incorrectly treated as applied")
        a.ledger=guard.applied_revocation_proofs(stopped,effective,a.ledger)
        proof=a.ledger["users"][key]["quotaRevocationApplied"]
        revocation_lease=stopped["users"][0]["quotaReservation"]
        # The first operational stop may arrive AFTER a higher signed
        # usage receipt (lost HTTP response / in-flight Xray bytes).
        # Rejecting it would deadlock stop acknowledgements; record it
        # without EVER treating its old usedBytes as a final refund meter.
        check(a.metrics(uid,proof["usedBytes"]+1,revocation_lease,
                        raw_total=20*MIB,stop=None),201,
              "accept signed late bytes before first stop proof")
        check(a.metrics(uid,proof["usedBytes"]+1,revocation_lease,
                        raw_total=20*MIB,stop=proof),201,
              "accept delayed first signed stop below settled usage without refund")
        code, preflight, _=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"read persisted stop application proof")
        item=next(item for item in preflight["nodes"] if item["nodeId"]==a.id)
        assert item["stopApplied"] and item["revocationRequestId"]==intent["requestId"]
        assert item["refundedBytes"]==0 and preflight["heldBytes"]>0,preflight
        assert item["awaitingFinalMeter"] and not item["finalMeterVerified"],item
        assert not item["canRefundNow"] and not preflight["canRefundNow"],preflight
        assert item["stopProofBelowSettledUsage"],item
        check(a.metrics(uid,proof["usedBytes"]+1,revocation_lease,raw_total=20*MIB,stop=proof),
              201,"replayed signed Node stop proof is idempotent")
        # Signed stale stop evidence must fail atomically even though the
        # receipt itself is genuine and a newer stop was already accepted.
        state_before_stale=account()
        stale=copy.deepcopy(proof)
        stale["usedBytes"]-=1
        assert stale["usedBytes"]>=0
        check(a.metrics(uid,proof["usedBytes"]+1,revocation_lease,raw_total=20*MIB,stop=stale),
              409,"reject rollback below previously accepted stop proof")
        assert account()==state_before_stale,account()
        older=copy.deepcopy(proof)
        older["revision"]-=1
        assert older["revision"]>=0
        check(a.metrics(uid,proof["usedBytes"]+1,revocation_lease,raw_total=20*MIB,stop=older),
              409,"reject stop proof revision rollback")
        assert account()==state_before_stale,account()
        # A node with another identity must never confirm A's revocation.
        forged=b.metrics(uid,proof["usedBytes"],grant_b,raw_total=0,stop=proof)
        check(forged,409,"reject substituted cross-node stop acknowledgment")
        # An authenticated late byte can arrive after the operational
        # stop proof. This proves that stop-applied is NOT final-meter-ready.
        check(a.metrics(uid,proof["usedBytes"]+2,revocation_lease,
                        raw_total=20*MIB,stop=proof),201,
              "accept further signed spending with exact replayed stop proof")
        code,preflight,_=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"inspect stop proof after late spending")
        item=next(row for row in preflight["nodes"] if row["nodeId"]==a.id)
        assert item["stopProofBelowSettledUsage"],item
        assert not item["canRefundNow"] and not preflight["canRefundNow"],preflight
        assert item["refundedBytes"]==0 and account()[1]>0,account()
        print("PASS: stale and late stop evidence is fenced without refunded bytes")
        # Explicit owner action is a FULL CHARGE, never a fake final meter.
        pre_burn_account=account()
        held_a=item["heldBytes"]
        assert held_a>0 and not item["conservativeBurned"],item
        burn_body={"nodeId":a.id,"requestId":intent["requestId"],
                   "confirmation":"CHARGE_ALL_REMAINING_BYTES_NO_REFUND"}
        bad_body={**burn_body,"confirmation":"REFUND_UNUSED_BYTES"}
        code,_,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",bad_body,cookie)
        check(code,400,"reject ambiguous or refundable burn request")
        assert account()==pre_burn_account
        wrong_id={**burn_body,"requestId":str(uuid.uuid4())}
        code,_,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",wrong_id,cookie)
        check(code,409,"reject unrelated revocation intent before charge")
        assert account()==pre_burn_account
        code,_,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",burn_body)
        check(code,401,"reject unauthenticated conservative charge")
        assert account()==pre_burn_account
        code,charged,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",
                           burn_body,cookie)
        check(code,200,"owner irreversibly charges entire revoked node hold")
        assert charged["chargedBytes"]==held_a and charged["refundedBytes"]==0,charged
        assert charged["finalMeterVerified"] is False and not charged["alreadyCharged"],charged
        after_burn=account()
        assert after_burn[0]==pre_burn_account[0]+held_a,(after_burn,pre_burn_account)
        assert after_burn[1]==pre_burn_account[1]-held_a,(after_burn,pre_burn_account)
        assert after_burn[2]==pre_burn_account[2],after_burn
        code,repeated_charge,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",
                                   burn_body,cookie)
        check(code,200,"exact owner replay cannot charge reservation twice")
        assert repeated_charge["alreadyCharged"] and account()==after_burn,repeated_charge
        code,status,_=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"preflight exposes charge separately from signed Node acknowledgement")
        charged_item=next(row for row in status["nodes"] if row["nodeId"]==a.id)
        assert charged_item["acknowledgedBytes"]<charged_item["conservativeBurnFloorBytes"],charged_item
        assert charged_item["conservativeBurnedBytes"]==held_a,charged_item
        assert charged_item["heldBytes"]==0 and not charged_item["finalMeterVerified"],charged_item
        assert status["canRefundNow"] is False
        # Delayed real Node receipts up to the prepaid burn floor are accepted
        # as actual readings, without a duplicate charge or newly issued grant.
        check(a.metrics(uid,proof["usedBytes"]+3,revocation_lease,raw_total=20*MIB,stop=proof),
              201,"accept genuine late signed usage within permanently charged floor")
        assert account()==after_burn,account()
        fresh_b, _=b.desired(uid,grant_b["acknowledgedBytes"],grant_b)
        assert fresh_b["users"][0]["quotaReservation"]["ceilingBytes"]==grant_b["ceilingBytes"]
        assert account()==after_burn
        # Optional emergency recovery can charge B's remaining offline
        # liability as well. No Node is falsely reported as final-metered.
        code, intent_b, _=api("POST",f"/users/{uid}/quota-v2/revocation",
                              {"nodeId":b.id},cookie)
        check(code,202,"start independent B revocation before permanent charge")
        charged_b_request={"nodeId":b.id,"requestId":intent_b["requestId"],
                           "confirmation":"CHARGE_ALL_REMAINING_BYTES_NO_REFUND"}
        code,burned_b,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",
                            charged_b_request,cookie)
        check(code,200,"charge B's entire outstanding balance without refund")
        assert burned_b["refundedBytes"]==0 and not burned_b["finalMeterVerified"]
        code,preflight,_=api("GET",f"/users/{uid}/quota-v2/revocation",cookie=cookie)
        check(code,200,"fully charged epoch may drain without fabricated Node meters")
        assert preflight["heldBytes"]==0 and preflight["canResetNow"],preflight
        assert all(row["conservativeBurned"] for row in preflight["nodes"]),preflight
        charged_old_epoch=preflight["epoch"]
        code,_,_=api("PATCH",f"/collections/users/{uid}",{"used":0},cookie)
        check(code,200,"reset only after entire old offline liability was charged")
        assert query("SELECT closed::text FROM quota_v2_accounts WHERE user_id="
                     +str(uid)+" AND epoch='"+charged_old_epoch+"'")=="true"
        code,after_reset_repeat,_=api("POST",f"/users/{uid}/quota-v2/conservative-burn",
                                     burn_body,cookie)
        check(code,200,"closed-epoch burn replay is read-only and idempotent")
        assert after_reset_repeat["alreadyCharged"]
        assert after_reset_repeat["chargedBytes"]==charged["chargedBytes"]
        # Rejoining nodes must preserve the absolute meter incarnation,
        # even when the actual Node usage was BELOW a paid burn floor.
        staged_a, _=a.desired(uid,proof["usedBytes"]+3,revocation_lease)
        staged_b, _=b.desired(uid,grant_b["acknowledgedBytes"],grant_b)
        new_a=staged_a["users"][0]["quotaReservation"]
        new_b=staged_b["users"][0]["quotaReservation"]
        assert new_a["epoch"]==new_b["epoch"] and new_a["epoch"]!=charged_old_epoch
        assert new_a["meterEpoch"]==revocation_lease["meterEpoch"]
        assert new_a["reservationId"]!=revocation_lease["reservationId"]
        assert new_a["acknowledgedBytes"]==new_a["ceilingBytes"]==proof["usedBytes"]+3
        assert new_b["acknowledgedBytes"]==new_b["ceilingBytes"]==grant_b["acknowledgedBytes"]
        assert account()[0]==0 and account()[1]==0,account()
        print("PASS: full-hold burn is replay-safe after reset and cannot mint old capacity")
    print("Two-node quota-v2 API/guard/PostgreSQL acceptance: PASS")

if __name__=="__main__":
    main()
