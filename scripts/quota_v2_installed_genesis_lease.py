"""Actual installed 6.0.27 Agent + real Xray + PostgreSQL signed cap rehearsal.

Run ONLY from the controlled disposable systemd harness. There is NO public
or production ingress. Nexus signs and commits caps from its own confirmed
leases. The runner independently checks both guests and their PostgreSQL rows.
"""
import concurrent.futures
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time

LEASE_PATH = "/api/v1/node/quota-v2/genesis-reservation"
CAP_PATH = "/api/v1/node/quota-v2/genesis-cap-delivery"
CAP_DOMAIN = b"XMESH_QUOTA_V2_XRAY_CAP_ADMISSION_V1\0"
WAL_PATH = "/api/v1/node/quota-v2/wal"
WAL_CHARGE_DOMAIN = b"XMESH_QUOTA_V2_WAL_CHARGE_V1\0"
MEASURED = "/var/lib/xmesh-measured-lab"
CAP_COMMAND = "/usr/local/sbin/xmesh-quota-genesis-cap-rehearsal"
STATE = "/var/lib/xmesh-xray-sync"
PREVIEW_DOMAIN = b"XMESH_XRAY_QUARANTINE_CONFIG_V1\0"
GENESIS_DOMAIN = b"XMESH_XRAY_GENESIS_PREPARED_V1\0"


def canonical(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode()


def parallel(fn, items):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(fn, items))


def independent_signature(root, name, doc, domain=b""):
    message, sig = root/(name+".message"), root/(name+".signature")
    assert doc["algorithm"] == "Ed25519"
    message.write_bytes(domain+canonical(doc["payload"]))
    sig.write_bytes(bytes.fromhex(doc["signature"]))
    subprocess.run(["openssl","pkeyutl","-verify","-pubin","-rawin",
                    "-inkey",os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"],
                    "-in",message,"-sigfile",sig],check=True,timeout=8,
                   stdout=subprocess.DEVNULL)


def try_signed_lease_pair(guests, db, root, panel, owner, stack, dsn, lab):
    assert os.environ.get("GITHUB_ACTIONS")=="true"
    assert os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted"
    assert os.environ.get("XMESH_AUDIT_DISPOSABLE")=="1"
    assert dsn.endswith("/quota_wal_installed")
    pair=[g for g,_ in guests]
    tags=("vless-main","vless-cdn")
    _,squad=owner.request("POST","/collections/squads",
                          {"name":"Genesis VLESS lab","inb":list(tags)})
    # Global balance lies between 1 MiB and 2 MiB: two simultaneous
    # bootstrap confirmations cannot each obtain the full requested MiB.
    _,user=owner.request("POST","/collections/users",{
        "username":"ci_genesis_lease_pair","squads":[squad["id"]],
        "hold":False,"used":0,"limit":0.001572864,"expireAt":0,
    })
    uid=user["id"]
    for guest,tag in zip(pair,tags):
        _,profile=owner.request("POST","/collections/profiles",{
            "name":"First Genesis "+tag,
            "config":json.dumps({
                "inbounds":[{"tag":tag,"listen":"127.0.0.1","port":28401,
                             "protocol":"vless","settings":{"decryption":"none","clients":[]},
                             "streamSettings":{"network":"tcp","security":"none"}}],
                "outbounds":[{"tag":"direct","protocol":"freedom","settings":{"finalRules":[
                    {"action":"allow","network":"tcp","ip":["127.0.0.1/32"],"port":"28421"}]}}],
                "routing":{"rules":[]},
            }),
        })
        owner.request("PATCH",f"/collections/nodes/{guest.node}",{
            "profileId":profile["id"],"xrayLocalPort":28401,
            "cdnMode":"all" if tag=="vless-cdn" else "standard",
        })
    calendar = os.environ.get("XMESH_QUOTA_V2_NODE_CALENDAR_STAGING") == "1"
    periods = ["lifetime", "lifetime"]
    if calendar:
        # Use two different UTC windows with sufficient time for the test.
        # Exact boundary behavior is covered by the independent PostgreSQL job.
        periods = [row[0] for row in db.execute(
            "SELECT p FROM unnest(ARRAY['daily','weekly','monthly']) WITH ORDINALITY t(p,i) "
            "WHERE upper(quota_v2_calendar_window(p,statement_timestamp())) "
            "> statement_timestamp()+interval '15 minutes' ORDER BY i LIMIT 2"
        )]
        # At a simultaneous near-midnight day/week/month boundary, let the
        # concurrency rehearsal continue with lifetime limits.
        periods += ["lifetime"] * (2 - len(periods))
    monthly_cdn = os.environ.get("XMESH_QUOTA_V2_CDN_CALENDAR_STAGING") == "1" and db.execute(
        "SELECT upper(quota_v2_calendar_window('monthly',statement_timestamp())) "
        "> statement_timestamp()+interval '15 minutes'"
    ).fetchone()[0]
    if monthly_cdn:
        owner.request("PATCH", "/settings", {"cdnResetPeriod": "monthly"})
    peer_limit = 4 * 64 * 1024
    _,peer=owner.request("POST","/collections/users",{
        "username":"ci_genesis_lease_peer","squads":[squad["id"]],
        "hold":False,"used":0,"limit":0,"expireAt":0,
        "cdnLimitGb":peer_limit / 1_000_000_000,
        "nodeTrafficLimits":{
            str(guest.node):{"limitGb":peer_limit / 1_000_000_000,"period":period}
            for guest,period in zip(pair,periods)
        },
    })
    peer_id=peer["id"]
    image=os.environ["XMESH_WAL_XRAY_IMAGE"]
    assert re.fullmatch(r"sha256:[a-f0-9]{64}",image)
    archive=root/"xray-image.tar"
    lab.docker("image","save","-o",archive,image)
    digest=os.environ["XMESH_WAL_XRAY_SHA256"]
    public=subprocess.check_output(["openssl","pkey","-pubin",
        "-in",os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"],"-outform","DER"],timeout=5)[-32:].hex()

    def load(guest):
        # Installed staging timer must be enabled, but explicit lab sequencing
        # keeps it quiescent until the live-VLESS automatic-charge test.
        guest.exec("systemctl","is-enabled","--quiet","xmesh-quota-v2-renewal.timer")
        guest.exec("systemctl","stop","xmesh-quota-v2-renewal.timer",
                   "xmesh-quota-v2-renewal.service")
        guest.exec("systemctl","stop",f"{lab.SYNC}.timer",f"{lab.SYNC}.service",
                   f"{lab.METRICS}.timer",f"{lab.METRICS}.service",
                   "xmesh-node-user-meter.timer","xmesh-node-user-meter.service")
        guest.exec("install","-d","-m","0700",MEASURED)
        lab.docker("cp",os.environ["XMESH_WAL_XRAY_BINARY"],f"{guest.name}:{MEASURED}/xray-client")
        lab.docker("cp",Path(__file__).with_name("quota_v2_installed_live_vless.py"),
                   f"{guest.name}:{MEASURED}/live-vless.py")
        assert guest.exec("sha256sum",MEASURED+"/xray-client").split()[0].decode()==digest
        with archive.open("rb") as bundle:
            lab.docker("exec","-i",guest.name,"docker","load",stdin=bundle,timeout=90)
        guest.exec("test","!","-e",STATE+"/policy-public-key")

    parallel(load,pair)

    def stage(item):
        guest,tag=item
        common=["--panel",panel,"--node-id",str(guest.node),"--state",STATE]
        command="/usr/local/sbin/xmesh-quota-genesis-quarantine"
        report=json.loads(guest.exec(command,*common,"--preview-only",timeout=40))
        assert report["authorizedBytes"]==0
        preview=json.loads(guest.exec("cat",STATE+"/genesis-config-preview.json"))
        independent_signature(root,f"preview-{guest.node}",preview,PREVIEW_DOMAIN)
        p=preview["payload"]
        config=canonical(p["config"])
        assert hashlib.sha256(config).hexdigest()==p["configSha256"]
        assert p["nodeId"]==guest.node and p["publicIngressAllowed"] is False
        assert p["config"]["api"]=={"tag":"xmesh_stats_api","listen":"127.0.0.1:10085",
                                     "services":["StatsService"]}
        assert all(inbound["tag"]!="xmesh_stats_in" for inbound in p["config"]["inbounds"])
        actual=[x for x in p["config"]["inbounds"] if x["tag"]==tag]
        assert len(actual)==1
        clients=actual[0]["settings"]["clients"]
        assert {client["email"]:client["id"] for client in clients} == {
            f"xmesh-u{uid}--{tag}":user["xrayId"],
            f"xmesh-u{peer_id}--{tag}":peer["xrayId"],
        }
        binding={"nodeId":guest.node,"activationReceiptSha256":p["activationReceiptSha256"],
                 "policyPublicKey":public}
        lab.start_isolated_candidate(guest,archive,image,config,
                                     preloaded=True,tag=tag,binding=binding)
        receipt=json.loads(guest.exec(command,*common,"--executable-sha256",digest,timeout=55))
        assert receipt["authorizedBytes"]==0 and receipt["canStart"] is False
        evidence=json.loads(guest.exec("cat",STATE+"/genesis-quarantine-envelope.json"))
        g=evidence["prepared"]["payload"]
        reply=evidence["reply"]
        independent_signature(root,f"genesis-{guest.node}",evidence["prepared"],GENESIS_DOMAIN)
        independent_signature(root,f"policy-{guest.node}",{
            "algorithm":"Ed25519","payload":reply["policy"],"signature":reply["policySignature"]})
        assert reply["config"]==p["config"] and reply["revision"]==p["configSha256"]
        assert reply["policySha256"]==receipt["policySha256"]
        assert guest.exec("cat",STATE+"/policy-public-key").decode().strip()==public
        req={"nodeId":guest.node,"userId":uid,"operation":"prepare",
             "policySha256":reply["policySha256"],"runtimeId":g["candidateRuntimeId"],
             "genesisChallenge":g["challenge"]}
        return guest,req,common

    stages=parallel(stage,zip(pair,tags))
    assert db.execute("SELECT count(*) FROM quota_v2_reservations").fetchone()==(0,)
    assert db.execute("SELECT count(*) FROM node_desired_revisions").fetchone()==(0,)
    print("Both installed 6.0.27 Agents got real signed preview and quarantine on measured isolated Xray.")

    def helper(item,operation):
        guest,_,common=item
        result=json.loads(guest.exec("/usr/local/sbin/xmesh-quota-genesis-reservation",
                         *common,"--user-id",str(uid),"--operation",operation,timeout=40))
        assert result["authorizedBytes"]==0 and result["canStart"] is False
        name="prepared" if operation=="prepare" else "confirmed"
        raw=guest.exec("cat",STATE+f"/genesis-reservation-{name}-u{uid}.json")
        doc=json.loads(raw)
        independent_signature(root,f"{name}-{guest.node}",doc)
        assert doc["payload"]["authorizedBytes"]==0 and doc["payload"]["canSpend"] is False
        return raw,doc

    def assert_saved(reply,original,stage_item,stage_name):
        raw,doc=reply
        code,body=original
        assert code==200 and doc==body and raw==canonical(body)
        saved=db.execute("SELECT signed_reply FROM quota_v2_genesis_lease_replies "
                         "WHERE node_id=%s AND user_id=%s AND stage=%s",
                         (stage_item[0].node,uid,stage_name)).fetchone()
        assert bytes(saved[0])==raw

    guest_a,request_a,_=stages[0]
    guest_b,request_b,_=stages[1]
    assert guest_a.request(LEASE_PATH,request_b)[0]==401
    assert guest_a.request(LEASE_PATH,dict(request_a,userId=uid+1000000))[0]==409

    # An independent quota is NOT a shared global allowance. An owner
    # can change these settings without changing the VLESS client's UUID
    # or its compiled config, so the current plan must be checked separately.
    user_path=f"/collections/users/{uid}"
    if not calendar:
        owner.request("PATCH",user_path,{
            "nodeTrafficLimits":{
                str(guest_a.node):{"limitGb":0.000000001,"period":"daily"},
                str(guest_b.node):{"limitGb":0.000000001,"period":"daily"},
            },
            "cdnLimitGb":0.000000001,
        })
        try:
            assert guest_a.request(LEASE_PATH,request_a)[0]==409
            assert guest_b.request(LEASE_PATH,request_b)[0]==409
            assert db.execute("SELECT count(*) FROM quota_v2_reservations WHERE user_id=%s",
                              (uid,)).fetchone()==(0,)
            assert db.execute("SELECT count(*) FROM quota_v2_genesis_lease_replies WHERE user_id=%s",
                              (uid,)).fetchone()==(0,)
        finally:
            owner.request("PATCH",user_path,{"nodeTrafficLimits":{},"cdnLimitGb":0})
        print("UTC-window Node and CDN limits cannot become global bootstrap grants.")
    # This lifetime Node rule is conservative and independently bounded:
    # A has 700 KiB, while the two-Node shared balance is 1.5 MiB.
    node_a_lifetime = 716800
    cdn_pool_lifetime = 1_572_864 - node_a_lifetime
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{
            "limitGb":node_a_lifetime/1_000_000_000,"period":"lifetime"}},
        "cdnLimitGb":cdn_pool_lifetime/1_000_000_000,
    })

    # Deliberately abandon both first authenticated replies (no Node disk
    # commit). The installed helper must recover precisely the saved bytes.
    first=parallel(lambda item:item[0].request(LEASE_PATH,item[1]),stages)
    prepared=parallel(lambda item:helper(item,"prepare"),stages)
    for result,original,item in zip(prepared,first,stages):
        assert_saved(result,original,item,"prepare")
        assert result[1]["payload"]["reservation"]["ceilingBytes"]==0
    confirms=[]
    for item,(_,doc) in zip(stages,prepared):
        lease=doc["payload"]["reservation"]
        confirms.append(dict(item[1],operation="confirm",
           echo={k:lease[k] for k in ("epoch","meterEpoch","reservationId")}))
    assert guest_a.request(LEASE_PATH,dict(confirms[0],echo=confirms[1]["echo"]))[0]==409
    lost=parallel(lambda item:item[0][0].request(LEASE_PATH,item[1]),zip(stages,confirms))
    confirmed=parallel(lambda item:helper(item,"confirm"),stages)
    for result,original,item in zip(confirmed,lost,stages):
        assert_saved(result,original,item,"confirm")

    lease_sql=("SELECT node_id,revision,ceiling_bytes,node_confirmed,acknowledged_bytes "
               "FROM quota_v2_reservations WHERE user_id=%s ORDER BY node_id")
    rows=db.execute(lease_sql,(uid,)).fetchall()
    assert len(rows)==2 and all(r[2]>0 and r[3] and r[4]==0 for r in rows),rows
    account=db.execute("SELECT limit_bytes,settled_bytes,observed_floor_bytes "
                       "FROM quota_v2_accounts WHERE user_id=%s AND NOT closed",(uid,)).fetchone()
    assert {row[0]:row[2] for row in rows}[guest_a.node] == node_a_lifetime, ("Node lifetime cap not enforced",rows)
    baseline=db.execute("SELECT baseline_bytes FROM quota_v2_node_lifetime_baselines "
        "WHERE user_id=%s AND node_id=%s",(uid,guest_a.node)).fetchone()
    assert baseline == (0,), ("Node lifetime baseline missing",baseline)
    assert {row[0]:row[2] for row in rows}[guest_b.node] == cdn_pool_lifetime, (
        "Shared lifetime CDN pool not enforced",rows)
    if monthly_cdn:
        bindings = db.execute(
            "SELECT r.node_id,b.period,b.calendar_window @> statement_timestamp(),"
            "r.valid_until <= upper(b.calendar_window) FROM quota_v2_reservations r "
            "JOIN quota_v2_cdn_calendar_bindings b USING(reservation_id) "
            "WHERE r.user_id=%s", (uid,)).fetchall()
        assert bindings == [(guest_b.node, "monthly", True, True)], bindings
    else:
        assert db.execute(
            "SELECT baseline_bytes FROM quota_v2_cdn_lifetime_baselines WHERE user_id=%s",
            (uid,)).fetchone() == (0,)
    assert dict(db.execute(
        "SELECT node_id,class FROM quota_v2_reservation_classes "
        "WHERE user_id=%s",(uid,)).fetchall()) == {
            guest_a.node:"main",guest_b.node:"cdn"}
    assert max(account[1],account[2])+sum(r[2] for r in rows)==account[0],(rows,account)
    retried=parallel(lambda item:helper(item,"confirm"),stages)
    assert retried==confirmed
    assert db.execute(lease_sql,(uid,)).fetchall()==rows
    assert db.execute("SELECT count(*) FROM quota_v2_signed_first_cap_outbox").fetchone()==(0,)
    assert db.execute("SELECT count(*) FROM node_desired_revisions").fetchone()==(0,)
    print("Both original zero-authority replies recovered after lost responses; simultaneous reservations conserve global quota.")

    def measure(item, *, replacement=False):
        guest,req,_=item
        original=json.loads(guest.exec("cat",STATE+"/genesis-quarantine-envelope.json"))
        profile=original["reply"]["revision"]
        code=(
            "import json,sys; "
            "sys.path.insert(0,'/usr/local/libexec/xmesh-quota-wal/quota-v2-physical-stop'); "
            "import wal_transport; "
            "print(json.dumps(wal_transport._measure_quarantined_runtime(tuple(sys.argv[1:]))))"
        )
        observed=json.loads(guest.exec("python3","-c",code,digest,profile))
        assert (observed[3]!=req["runtimeId"]) if replacement else (observed[3]==req["runtimeId"])
        raw=guest.exec("cat",MEASURED+"/config.json")
        assert hashlib.sha256(raw).hexdigest()==profile
        return observed

    def start_external_endpoint(guest, observed):
        # Lab ingress is reachable only from this guest. Pin the kernel
        # namespace so a reused PID cannot redirect the fixture to another process.
        guest.exec("ip", "netns", "attach", "quota-vless", str(observed[2]))
        guest.exec("systemd-run", "--unit=xmesh-lab-ingress", "--collect",
                   "/usr/bin/systemd-socket-activate", "--listen=127.0.0.1:28401",
                   "/usr/bin/nsenter", "--no-fork", "--net=/run/netns/quota-vless",
                   "/usr/lib/systemd/systemd-socket-proxyd", "127.0.0.1:28401")
        lab.wait_for(lambda: b"127.0.0.1:28401" in guest.exec("ss", "-lnt"),
                     label="external guest-loopback VLESS listener")

    def probe(item,ceiling,observed,tag,previous=0,barrier=None,pause_after=0,subscriber=user,
              reuse_echo=False):
        guest,_,_=item
        raw=guest.exec("python3",MEASURED+"/live-vless.py",MEASURED+"/xray-client",
                       subscriber["xrayId"],f"xmesh-u{subscriber['id']}--{tag}",str(ceiling),str(previous),
                       *([barrier,str(pause_after)] if barrier else []),
                       "--server-pid",str(observed[2]),
                       *(["--reuse-echo","--socks-port","28412"] if reuse_echo else []),
                       timeout=120 if barrier else 48)
        return json.loads(raw)

    measurements=parallel(measure,stages)
    for guest, measured in zip(pair, measurements):
        start_external_endpoint(guest, measured)
    before=parallel(lambda job:probe(job[0],0,job[1],job[2]),
                    zip(stages,measurements,tags))
    assert before==[{"uplink":0,"downlink":0}]*2
    assert parallel(lambda job:probe(job[0],0,job[1],job[2],subscriber=peer),
                    zip(stages,measurements,tags))==before
    # The CI host owns the disposable guest/root. It directly reads the
    # measured kernel process and private WAL directory, not a Node claim.
    # Verify both original isolated processes have no historic WAL or cap.
    for (guest,_,_),_ in zip(stages,measurements):
        names=guest.exec("ls","-1A",MEASURED+"/wal/ledger").decode().splitlines()
        assert not any(n.startswith(("meter-","positive-cap-")) for n in names),names
        assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors WHERE node_id=%s",
                          (guest.node,)).fetchone()==(0,)

    cap_jobs=[]
    for item,measurement,saved in zip(stages,measurements,confirmed):
        guest,req,_=item
        container,_,pid,runtime=measurement
        lease=saved[1]["payload"]["reservation"]
        nonce=hashlib.sha256(
            f"XMESH_QUOTA_V2_FIRST_CAP_V1\0{req['genesisChallenge']}\0{uid}".encode("ascii")
        ).hexdigest()
        lookup={"nodeId":guest.node,"userId":uid,"requestChallenge":nonce}
        assert guest.request(CAP_PATH,lookup)[0]==409, "read-only lookup minted a cap"
        cap_request=dict(lookup,measurement={
            "containerId":container,"hostPid":pid,"runtimeId":runtime,
        })
        if not cap_jobs:
            db.execute("ALTER TABLE quota_v2_signed_first_cap_outbox ADD CONSTRAINT "
                       "ci_reject_cap_write CHECK (false) NOT VALID")
            try:
                status,_=guest.request(CAP_PATH,cap_request)
                assert status==500, status
                assert db.execute("SELECT count(*) FROM quota_v2_runtime_admission_preflights "
                                  "WHERE node_id=%s AND request_challenge=%s",
                                  (guest.node,nonce)).fetchone()==(0,)
                assert db.execute("SELECT count(*) FROM quota_v2_signed_first_cap_outbox "
                                  "WHERE node_id=%s",(guest.node,)).fetchone()==(0,)
            finally:
                db.execute("ALTER TABLE quota_v2_signed_first_cap_outbox "
                           "DROP CONSTRAINT ci_reject_cap_write")
        # Only the installed service performs the first positive issuance.
        # Wait for it to acknowledge installation before deliberately
        # duplicating the exact request below.
        guest.exec("test","!","-e",STATE+f"/genesis-positive-cap-u{uid}.json")
        guest.exec("systemctl","start","xmesh-quota-v2-renewal.service",timeout=95)
        issued=parallel(lambda _: guest.request(CAP_PATH,cap_request),range(2))
        code,signed=issued[0]
        assert code==200,(code,signed)
        assert issued[1]==issued[0]
        assert signed["status"]=="committed_first_cap"
        grant=signed["signedEnvelope"].encode()
        assert guest.request(CAP_PATH,lookup)==(200,signed)
        assert guest.request(CAP_PATH,dict(cap_request,measurement={
            **cap_request["measurement"],"hostPid":pid+1,
        }))[0]==409
        cap=json.loads(grant)
        independent_signature(root,f"cap-{guest.node}",cap,CAP_DOMAIN)
        assert cap["payload"]["sharedCeilingBytes"]==lease["ceilingBytes"]
        # The real signed outbox fetch must preserve the independently
        # classified CDN authority: MAIN has zero, CDN-only has exactly
        # its own fully reserved ceiling, never an unbounded cap.
        expected_cdn = lease["ceilingBytes"] if tags[len(cap_jobs)]=="vless-cdn" else 0
        assert cap["payload"]["cdnCeilingBytes"]==expected_cdn
        assert cap["payload"]["nodeCeilingBytes"]==lease["ceilingBytes"]
        assert cap["payload"]["runtimeId"]==runtime
        assert db.execute("SELECT signed_envelope FROM quota_v2_signed_first_cap_outbox "
                          "WHERE node_id=%s AND request_challenge=%s",
                          (guest.node,nonce)).fetchone()[0]==grant
        cap_jobs.append((item,measurement,cap_request,grant,lease["ceilingBytes"]))

    assert guest_a.request(CAP_PATH,cap_jobs[1][2])[0]==401
    assert guest_a.request(CAP_PATH,dict(cap_jobs[0][2],requestChallenge=cap_jobs[1][2]["requestChallenge"]))[0]==409

    if monthly_cdn:
        try:
            for policy_period in ("daily", "weekly"):
                owner.request("PATCH", "/settings", {"cdnResetPeriod": policy_period})
                # A changed window cannot fund or replay the old CDN
                # entitlement. The other node's MAIN permit stays valid.
                assert guest_b.request(CAP_PATH,cap_jobs[1][2])[0]==409
                assert guest_a.request(CAP_PATH,cap_jobs[0][2])[0]==200
        finally:
            owner.request("PATCH", "/settings", {"cdnResetPeriod": "monthly"})

    # Even already signed outbox bytes may not be delivered after the
    # owner's plan has changed. These checks must not consume or renew them.
    original_caps=db.execute(
        "SELECT node_id,request_challenge,signed_envelope FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge"
    ).fetchall()
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.000000001,"period":"daily"}},
        "cdnLimitGb":0.000000001,
    })
    try:
        assert guest_a.request(CAP_PATH,cap_jobs[0][2])[0]==409
        assert guest_b.request(CAP_PATH,cap_jobs[1][2])[0]==409
        assert db.execute("SELECT node_id,request_challenge,signed_envelope "
                          "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge").fetchall()==original_caps
    finally:
        owner.request("PATCH",user_path,{
            "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.003,"period":"lifetime"}},
            "cdnLimitGb":cdn_pool_lifetime/1_000_000_000,
        })

    # Lowering only A's lifetime quota below its already committed grant
    # must stop fresh delivery on A but not disable the unaffected B cap.
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{
            "limitGb":0.000000001,"period":"lifetime"}},
        "cdnLimitGb":cdn_pool_lifetime/1_000_000_000,
    })
    try:
        assert guest_a.request(CAP_PATH,cap_jobs[0][2])[0]==409
        assert guest_b.request(CAP_PATH,cap_jobs[1][2])[0]==200
        assert db.execute("SELECT node_id,request_challenge,signed_envelope "
            "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge").fetchall()==original_caps
    finally:
        owner.request("PATCH",user_path,{
            "nodeTrafficLimits":{str(guest_a.node):{
                "limitGb":0.003,"period":"lifetime"}},
            "cdnLimitGb":cdn_pool_lifetime/1_000_000_000,
        })

    # Lowering the GLOBAL CDN pool below already issued B ceiling must deny
    # B's signed cap while MAIN on A remains available. No reclaim or
    # untrusted remote report can release that outstanding CDN reservation.
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.003,"period":"lifetime"}},
        "cdnLimitGb":0.000000001,
    })
    try:
        assert guest_a.request(CAP_PATH,cap_jobs[0][2])[0]==200
        assert guest_b.request(CAP_PATH,cap_jobs[1][2])[0]==409
        assert db.execute(
            "SELECT node_id,request_challenge,signed_envelope "
            "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge"
        ).fetchall()==original_caps
    finally:
        owner.request("PATCH",user_path,{
            "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.003,"period":"lifetime"}},
            "cdnLimitGb":cdn_pool_lifetime/1_000_000_000,
        })

    # A signed spending-only cap cannot outlive a shortened subscription.
    # Restore the original expiry only after both fresh deliveries are denied.
    original_expiry=user.get("expireAt",0)
    short_expiry=db.execute(
        "SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint+300000"
    ).fetchone()[0]
    owner.request("PATCH",user_path,{"expireAt":short_expiry})
    try:
        for item,_,request,_,_ in cap_jobs:
            assert item[0].request(CAP_PATH,request)[0]==409
        assert db.execute("SELECT node_id,request_challenge,signed_envelope "
                          "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge").fetchall()==original_caps
    finally:
        owner.request("PATCH",user_path,{"expireAt":original_expiry})
    print("Shortened subscription cannot reuse an already signed longer-lived cap.")

    def install(job):
        item,measurement,request,grant,ceiling=job
        guest,_,common=item
        # Abandon a transport response first: actual Agent must fetch the
        # EXACT same immutable signed positive grant again.
        status,original=guest.request(CAP_PATH,request)
        assert status==200 and original["signedEnvelope"].encode()==grant
        cmd=["env","XMESH_QUOTA_V2_INSTALLED_CAP_DELIVERY=1",CAP_COMMAND,*common,
             "--user-id",str(uid),"--socket",MEASURED+"/wal/drain.sock",
             "--executable-sha256",digest,"--request-challenge",request["requestChallenge"]]
        saved=json.loads(guest.exec("cat",STATE+f"/genesis-positive-cap-u{uid}.json"))
        assert saved["signedEnvelope"].encode()==grant
        stored=guest.exec("cat",MEASURED+f"/wal/ledger/positive-cap-u{uid}.json")
        assert stored==grant
        return cmd

    commands=parallel(install,cap_jobs)
    print("PASS: the installed systemd Agent acquired and installed each first cap after signed quarantine.")
    assert db.execute("SELECT count(*) FROM quota_v2_signed_first_cap_outbox").fetchone()==(4,)
    if calendar:
        bindings = db.execute(
            "SELECT o.node_id, b.period, o.valid_until_ms "
            "<= (EXTRACT(epoch FROM upper(b.calendar_window))*1000)::bigint "
            "FROM quota_v2_signed_first_cap_outbox o "
            "JOIN quota_v2_node_calendar_bindings b USING(reservation_id) WHERE o.user_id=%s",
            (peer_id,),
        ).fetchall()
        assert sorted(bindings) == sorted((guest.node,period,True)
            for guest,period in zip(pair,periods) if period != "lifetime"), bindings

    if monthly_cdn:
        cdn_binding = db.execute(
            "SELECT o.node_id, b.period, o.valid_until_ms "
            "<= (EXTRACT(epoch FROM upper(b.calendar_window))*1000)::bigint "
            "FROM quota_v2_signed_first_cap_outbox o JOIN quota_v2_cdn_calendar_bindings b "
            "USING(reservation_id) WHERE o.user_id=%s", (peer_id,),
        ).fetchall()
        assert cdn_binding == [(guest_b.node,"monthly",True)], cdn_binding
    results=parallel(lambda value:probe(value[0][0],value[0][4],
                                       value[0][1],value[1]),zip(cap_jobs,tags))
    assert sum(sum(result.values()) for result in results)==account[0]
    wal_snapshots=[]
    for job,tag,result in zip(cap_jobs,tags,results):
        item,measurement,_,grant,ceiling=job
        guest,_,_=item
        assert sum(result.values())==ceiling
        runtime=measurement[3]
        snapshot={}
        for direction in ("uplink","downlink"):
            key=f"{runtime}\0xmesh-u{uid}--{tag}\0{direction}".encode()
            path=MEASURED+"/wal/ledger/meter-"+hashlib.sha256(key).hexdigest()+".jsonl"
            raw=guest.exec("cat",path)
            assert json.loads(raw.splitlines()[-1])["nextBytes"]==result[direction]
            snapshot[path]=raw
        wal_snapshots.append(snapshot)
    print("Both installed Agents fetched genuine Nexus-signed PostgreSQL caps via strict XSP/2, applied them to real Xray, and VLESS/StatsService/WAL exhausted exactly conserved shared bytes.")

    def remote_wal_command(guest, operation):
        return ["/usr/local/sbin/xmesh-quota-wal", operation,
                "--panel", panel, "--node-id", str(guest.node)]

    def check_remote_wal(guest, operation):
        proof = json.loads(guest.exec(*remote_wal_command(guest, operation), timeout=75))
        for field in ("nexusOffhostSignatureVerified", "offhostFullBirthIndexHeadMatched",
                      "nodeLocalIndexExtendsNexusHead"):
            assert proof[field] is True, proof
        for field in ("canResume", "carryforwardApplied", "finalMeterVerified"):
            assert proof[field] is False, proof
        assert proof["refundableBytes"] == 0, proof

    # B provides the independent transaction rollback fixture. A must
    # publish its first birth index from the installed service.
    check_remote_wal(guest_b, "store")
    anchor_sql = """SELECT a.inventory_sequence,a.inventory_sha256,a.inventory_bytes,s.witness_bytes
                    FROM quota_v2_external_wal_birth_anchors a
                    JOIN quota_v2_external_wal_birth_sources s USING(node_id,inventory_sequence)
                    WHERE a.node_id=%s ORDER BY a.inventory_sequence DESC LIMIT 1"""

    def remote_anchor(guest,expected_streams=2):
        anchor = db.execute(anchor_sql, (guest.node,)).fetchone()
        assert anchor is not None, guest.node
        sequence, digest, inventory, witness = anchor
        local = guest.exec("cat", MEASURED+"/wal/ledger/xmesh-meter-inventory-v1.jsonl")
        assert sequence == len(local.splitlines()) == expected_streams
        assert bytes(inventory) == local and digest == hashlib.sha256(local).hexdigest()
        assert json.loads(bytes(witness))["payload"]["nodeId"] == guest.node
        return anchor

    assert db.execute(anchor_sql, (guest_a.node,)).fetchone() is None
    assert db.execute(lease_sql,(uid,)).fetchall()==rows

    def charge_request(guest, grant, path, raw):
        return {
            "operation": "charge", "nodeId": guest.node,
            "reservationId": json.loads(grant)["payload"]["reservationId"],
            "filename": Path(path).name, "journal": base64.b64encode(raw).decode(),
        }

    charge_jobs = []
    for job, snapshot in zip(cap_jobs, wal_snapshots):
        item, _, _, grant, _ = job
        guest = item[0]
        batches = []
        for path, raw in snapshot.items():
            lines = raw.splitlines(keepends=True)
            middle = len(lines) // 2
            assert middle
            batches.append([charge_request(guest, grant, path, b"".join(chunk))
                            for chunk in (lines[:middle], lines[middle:])])
        charge_jobs.append((guest, batches))

    first_batch, later_batch = charge_jobs[0][1][0]
    assert guest_a.request(WAL_PATH, later_batch)[0] == 409
    assert guest_b.request(WAL_PATH, dict(first_batch, nodeId=guest_b.node))[0] == 409
    charge_sql = ("SELECT reservation_id,filename,first_sequence,last_sequence,journal,signed_receipt "
                  "FROM quota_v2_wal_charges ORDER BY reservation_id,filename,first_sequence")
    balance_sql = ("SELECT settled_bytes,observed_floor_bytes FROM quota_v2_accounts "
                   "WHERE user_id=%s AND NOT closed")
    db.execute("ALTER TABLE quota_v2_wal_charges ADD CONSTRAINT ci_reject_wal CHECK (false) NOT VALID")
    try:
        assert guest_b.request(WAL_PATH, charge_jobs[1][1][0][0])[0] == 500
        assert db.execute(charge_sql).fetchall() == []
        assert db.execute("SELECT count(*) FROM quota_v2_wal_stream_owners").fetchone() == (0,)
        assert db.execute(balance_sql, (uid,)).fetchone() == account[1:]
    finally:
        db.execute("ALTER TABLE quota_v2_wal_charges DROP CONSTRAINT ci_reject_wal")

    def upload(job):
        guest, batches = job
        committed = []
        if guest.node == guest_a.node:
            # For Node A, the installed opt-in Agent performs the FIRST
            # charge itself through systemd and strict XSP/2. No controller
            # inserts SQL, fabricates a receipt or invokes a signing fixture.
            guest.exec("systemctl","start","xmesh-quota-v2-renewal.service",timeout=180)
            grant = json.loads(cap_jobs[0][3])["payload"]
            archived = json.loads(guest.exec(
                "cat", STATE + f"/wal-cap-u{grant['userId']}-{grant['runtimeId']}.json"))
            assert archived["signedEnvelope"].encode() == cap_jobs[0][3]
            saved = db.execute(
                "SELECT filename,journal,signed_receipt FROM quota_v2_wal_charges "
                "WHERE reservation_id=%s::uuid ORDER BY filename,first_sequence",
                (grant["reservationId"],)).fetchall()
            assert len(saved) == len(batches), ("Agent did not settle every Xray WAL", saved)
            for filename, journal, signature in saved:
                raw, receipt = bytes(journal), bytes(signature)
                request = charge_request(guest, cap_jobs[0][3], MEASURED+"/wal/ledger/"+filename, raw)
                reply = {"receipt":base64.b64encode(receipt).decode()}
                assert guest.request(WAL_PATH, request) == (200, reply)
                independent_signature(root, f"agent-charge-{filename}", json.loads(receipt),
                                      WAL_CHARGE_DOMAIN)
                last = json.loads(raw.splitlines()[-1])
                key = hashlib.sha256(filename.encode("ascii")).hexdigest()
                stored = json.loads(guest.exec("cat", STATE+
                    f"/wal-charge-{key}-s{last['sequence']}.json"))
                assert stored["signedReceipt"] == reply["receipt"]
                assert stored["reservationId"] == grant["reservationId"]
                committed.append((request,reply))
            return committed
        for split in batches:
            for request in split:
                first = guest.request(WAL_PATH, request)
                status, reply = guest.request(WAL_PATH, request)
                assert status == 200 and first == (status, reply), (status, reply)
                raw = base64.b64decode(request["journal"], validate=True)
                receipt = json.loads(base64.b64decode(reply["receipt"], validate=True))
                payload = receipt["payload"]
                independent_signature(root, f"wal-charge-{guest.node}", receipt, WAL_CHARGE_DOMAIN)
                assert payload["nodeId"] == guest.node and payload["userId"] == uid
                assert payload["reservationId"] == request["reservationId"]
                assert payload["filename"] == request["filename"]
                assert payload["journalSha256"] == hashlib.sha256(raw).hexdigest()
                assert payload["firstSequence"] == json.loads(raw.splitlines()[0])["sequence"]
                tail = json.loads(raw.splitlines()[-1])
                assert payload["lastDigest"] == tail["digest"] and payload["streamBytes"] == tail["nextBytes"]
                assert payload["finalMeterVerified"] is False and payload["refundableBytes"] == 0
                committed.append((request, reply))
        return committed

    # Keep the controller's negative/corrupt-order tests for the other
    # installed Node. Avoid a shared psycopg connection across workers.
    charges = [upload(charge_jobs[0]), upload(charge_jobs[1])]
    anchors = [remote_anchor(guest) for guest in pair]
    print("PASS: installed Agent bootstrapped the first WAL birth index and charged it through strict XSP/2.")
    charged_rows = db.execute(charge_sql).fetchall()
    assert len(charged_rows) == 6
    assert set(db.execute("SELECT reservation_id,filename FROM quota_v2_wal_stream_owners").fetchall()) == {
        (row[0], row[1]) for row in charged_rows
    }
    charged_balance = db.execute(balance_sql, (uid,)).fetchone()
    assert charged_balance == (account[0], account[2]), charged_balance
    floors = db.execute("SELECT node_id,conservative_burn_floor_bytes FROM quota_v2_reservations "
                        "WHERE user_id=%s ORDER BY node_id", (uid,)).fetchall()
    assert floors == [(row[0], row[2]) for row in rows], floors
    assert db.execute(lease_sql, (uid,)).fetchall() == rows
    print("PASS: signed WAL charges on two Nodes conserved the balance after rollback and retries.")

    # Raise the same user's limit through the panel, then allocate only the
    # added capacity. Both renewals must use the real Nexus signer.
    item, measured, original_request, first_grant, _ = cap_jobs[0]
    installed = json.loads(first_grant)["payload"]
    cumulative = installed["sharedCeilingBytes"]
    expected_limit = account[0]
    renewals_sql = ("SELECT reservation_id,revision,nonce,grant_bytes,signed_envelope "
                    "FROM quota_v2_cap_renewals ORDER BY reservation_id,revision")
    assert guest_a.request(CAP_PATH, dict(original_request, requestChallenge=secrets.token_hex(32),
        renewal={"reservationId": installed["reservationId"],
                 "previousRevision": installed["reservationRevision"]}))[0] == 409
    previous_request = None
    barrier = MEASURED + "/renewal-" + secrets.token_hex(12)
    half = 256 * 1024
    assert cumulative >= 2 * half

    # Let the actual installed systemd timer perform both renewals. The
    # controller only changes an owner's plan and observes signed disk and SQL
    # evidence; no test fixture signs the grant or manually calls Agent helpers.
    guest_a.exec("systemctl","start","xmesh-quota-v2-renewal.timer")
    guest_a.exec("systemctl","is-active","--quiet","xmesh-quota-v2-renewal.timer")

    def signed_auto_renewal(revision):
        target = STATE + f"/genesis-renewal-u{uid}-r{revision}.json"
        deadline = time.monotonic() + 110
        while time.monotonic() < deadline:
            raw = guest_a.exec("bash","-ec",
                'test ! -s "$1" || cat "$1"', "bash", target, timeout=7)
            if raw:
                evidence = json.loads(raw)
                assert evidence["status"] == "committed_renewal"
                assert evidence["nodeId"] == guest_a.node and evidence["userId"] == uid
                return evidence
            time.sleep(.8)
        logs = guest_a.exec("journalctl","-u","xmesh-quota-v2-renewal.service",
                            "-n","70","--no-pager","-o","cat",timeout=15)
        raise AssertionError(f"installed Agent did not auto-renew revision {revision}: {logs[-6000:]!r}")

    def wait_wal_floor(minimum):
        deadline = time.monotonic() + 110
        while time.monotonic() < deadline:
            saved = db.execute(
                "SELECT conservative_burn_floor_bytes FROM quota_v2_reservations "
                "WHERE node_id=%s AND user_id=%s", (guest_a.node,uid)).fetchone()
            if saved and saved[0] >= minimum:
                return saved[0]
            time.sleep(.8)
        logs = guest_a.exec("journalctl","-u","xmesh-quota-v2-renewal.service",
                            "-n","70","--no-pager","-o","cat",timeout=15)
        raise AssertionError(f"staged Agent did not settle real VLESS WAL {minimum}: {logs[-6000:]!r}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as live_pool:
        for step, increment in enumerate((2 * half, half)):
            expected_limit += increment
            owner.request("PATCH", user_path, {"limit": expected_limit / 1_000_000_000})
            saved = signed_auto_renewal(installed["reservationRevision"] + 1)
            raw = saved["signedEnvelope"].encode()
            doc = json.loads(raw)
            independent_signature(root, f"auto-renewed-{step}", doc, CAP_DOMAIN)
            new = doc["payload"]
            # Replay the exact request made autonomously by Agent and prove
            # that a competing nonce can neither reserve nor deliver bytes.
            request = dict(original_request, requestChallenge=new["nonce"], renewal={
                "reservationId": installed["reservationId"],
                "previousRevision": installed["reservationRevision"],
            })
            results = parallel(lambda _: guest_a.request(CAP_PATH,request), range(2))
            assert results == [(200,saved)]*2, results
            if previous_request is not None:
                assert guest_a.request(CAP_PATH, previous_request)[0] == 409
            assert guest_a.request(CAP_PATH, dict(
                request, requestChallenge=secrets.token_hex(32)))[0] == 409
            assert new["reservationRevision"] == installed["reservationRevision"] + 1
            assert new["sharedCeilingBytes"] == installed["sharedCeilingBytes"] + increment
            assert new["validUntilMs"] == installed["validUntilMs"]
            assert new["witnessedWalBytes"] == cumulative
            assert new["runtimeId"] == measured[3]
            assert measure(item) == measured
            # The signed file is persisted ONLY after the local Unix-socket
            # peer's receipt from the original process was verified.
            if step == 0:
                active = live_pool.submit(
                    probe, item, 3 * half, measured, tags[0], cumulative, barrier, half)
                deadline = time.monotonic() + 30
                while True:
                    if active.done():
                        raise AssertionError(
                            f"VLESS ended before the second automatic renewal: {active.result()}")
                    if time.monotonic() >= deadline:
                        raise TimeoutError("VLESS failed to reach the automatic renewal barrier")
                    if guest_a.exec("sh", "-c", 'test -f "$1" && printf ready || true',
                                    "sh", barrier + ".ready") == b"ready":
                        break
                    time.sleep(.15)
                # A second subscriber completes real traffic on this Xray
                # while the first subscriber's VLESS stream stays open.
                assert probe(item,peer_limit,measured,tags[0],subscriber=peer,
                             reuse_echo=True) == {
                    "uplink":peer_limit//2,"downlink":peer_limit//2,
                }
                assert not active.done()
                cumulative += half
            else:
                assert not active.done(), "VLESS ended before the automatic cap was applied"
                guest_a.exec("touch", barrier + ".continue")
                live = active.result(timeout=30)
                cumulative += 2 * half
                assert sum(live.values()) == cumulative
            # No operator WAL upload: the systemd timer settles newly
            # fsynced bytes over strict XSP/2 and advances the SQL charge floor.
            wait_wal_floor(cumulative)
            for path, prior in list(wal_snapshots[0].items()):
                updated = guest_a.exec("cat", path)
                assert updated.startswith(prior) and updated != prior
                wal_snapshots[0][path] = updated
            installed = new
            previous_request = request
    renewal_rows = db.execute(renewals_sql).fetchall()
    assert len(renewal_rows) == 2
    rows = db.execute(lease_sql, (uid,)).fetchall()
    charged_rows = db.execute(charge_sql).fetchall()
    charged_balance = db.execute(balance_sql, (uid,)).fetchone()
    assert charged_balance == (expected_limit, account[2])
    print("PASS: installed systemd Agent settled WAL and auto-renewed twice via Nexus; one uninterrupted VLESS stream crossed its earlier ceiling.")

    # Reuse the SAME live Xray processes. The first subscriber already
    # exhausted both original reservations. The second subscriber already
    # spent its own budget concurrently on A and now uses its share on B.
    guest_a.exec("systemctl","stop","xmesh-quota-v2-renewal.timer",
                 "xmesh-quota-v2-renewal.service")
    assert probe(stages[1],peer_limit,measurements[1],tags[1],subscriber=peer) == {
        "uplink":peer_limit//2,"downlink":peer_limit//2,
    }
    parallel(lambda guest: guest.exec(
        "systemctl","start","xmesh-quota-v2-renewal.service",timeout=95),pair)
    peer_settled=db.execute(
        "SELECT r.node_id, SUM(c.stream_bytes), count(DISTINCT c.filename) "
        "FROM quota_v2_reservations r JOIN quota_v2_wal_charges c USING(reservation_id) "
        "WHERE r.user_id=%s GROUP BY r.node_id ORDER BY r.node_id",(peer_id,),
    ).fetchall()
    assert peer_settled == sorted((guest.node,peer_limit,2) for guest in pair),peer_settled
    assert db.execute(balance_sql,(peer_id,)).fetchone()==(2*peer_limit,0)
    assert db.execute(balance_sql,(uid,)).fetchone()==charged_balance
    charged_rows=db.execute(charge_sql).fetchall()
    anchors=[remote_anchor(guest,expected_streams=4) for guest in pair]
    print("PASS: two users spent independent signed budgets on the same two Xray processes; Agent settled both users' WAL.")

    # A repeat cannot extend/reinstall the existing positive cap.
    repeated=subprocess.run(["docker","exec",guest_a.name,*commands[0]],
                             capture_output=True,timeout=35)
    assert repeated.returncode!=0, "positive cap replay was admitted twice"
    outbox_sql="SELECT node_id,request_challenge,signed_envelope FROM quota_v2_signed_first_cap_outbox ORDER BY node_id,request_challenge"
    committed_caps=db.execute(outbox_sql).fetchall()
    assert len(committed_caps)==4

    for guest in pair:
        assert guest.exec("docker","inspect","-f","{{.HostConfig.NetworkMode}}",lab.XRAY).strip()==b"none"
        assert not guest.exec("docker","port",lab.XRAY).strip()
    guest_a.exec("docker","kill","--signal","KILL",lab.XRAY)
    failed=subprocess.run(["docker","exec",guest_a.name,"/usr/local/sbin/xmesh-quota-genesis-reservation",
                           *stages[0][2],"--user-id",str(uid),"--operation","confirm"],
                          capture_output=True,timeout=25)
    assert failed.returncode!=0
    assert guest_b.exec("docker","inspect","-f","{{.State.Running}}",lab.XRAY).strip()==b"true"
    # A fresh isolated process with the exact same image, config and old WAL
    # must not inherit the consumed grant or reopen data-plane admission.
    original=json.loads(guest_a.exec("cat",STATE+"/genesis-quarantine-envelope.json"))
    binding={"nodeId":guest_a.node,
             "activationReceiptSha256":original["prepared"]["payload"]["activationReceiptSha256"],
             "policyPublicKey":public}
    config=guest_a.exec("cat",MEASURED+"/config.json")
    guest_a.exec("docker","rm",lab.XRAY)
    lab.start_isolated_candidate(guest_a,archive,image,config,preloaded=True,
                                 tag=tags[0],binding=binding)
    guest_a.exec("systemctl", "stop", "xmesh-lab-ingress.service")
    guest_a.exec("ip", "netns", "delete", "quota-vless")
    replacement=measure(stages[0],replacement=True)
    start_external_endpoint(guest_a, replacement)
    assert replacement[0]!=measurements[0][0]
    failed=subprocess.run(["docker","exec",guest_a.name,*commands[0]],
                          capture_output=True,timeout=35)
    assert failed.returncode!=0, "old grant accepted by replacement Xray"
    assert probe(stages[0],0,replacement,tags[0])=={"uplink":0,"downlink":0}
    assert all(guest_a.exec("cat",path)==raw for path,raw in wal_snapshots[0].items())
    ledger_sql="SELECT node_id,stage,signed_reply FROM quota_v2_genesis_lease_replies ORDER BY node_id,user_id,stage"
    ledger=db.execute(ledger_sql).fetchall()
    assert len(ledger)==8
    db=lab.restart_postgres(stack,dsn,db)
    assert db.execute(ledger_sql).fetchall()==ledger
    assert db.execute(outbox_sql).fetchall()==committed_caps
    assert db.execute(renewals_sql).fetchall()==renewal_rows
    assert db.execute(lease_sql,(uid,)).fetchall()==rows
    assert db.execute(charge_sql).fetchall() == charged_rows
    assert db.execute(balance_sql, (uid,)).fetchone() == charged_balance
    for guest, receipts in zip(pair, charges):
        for request, reply in receipts:
            assert guest.request(WAL_PATH, request) == (200, reply)
    assert [remote_anchor(guest,expected_streams=4) for guest in pair] == anchors
    parallel(lambda guest: check_remote_wal(guest, "head"), pair)
    for guest,snapshot in zip(pair,wal_snapshots):
        assert all(guest.exec("cat",path)==raw for path,raw in snapshot.items())

    # Preserve the original inode while testing loss on the replacement.
    missing = next(iter(wal_snapshots[0]))
    # Keep the held file outside the directory of authoritative WALs.
    hidden = MEASURED + "/" + Path(missing).name + ".held"
    guest_a.exec("mv", missing, hidden)
    try:
        failed = subprocess.run(
            ["docker","exec",guest_a.name,*remote_wal_command(guest_a, "head")],
            capture_output=True,timeout=75,
        )
        assert failed.returncode != 0, "signed Nexus head concealed a missing local WAL"
        assert probe(stages[0],0,replacement,tags[0]) == {"uplink":0,"downlink":0}
    finally:
        guest_a.exec("mv", hidden, missing)
    check_remote_wal(guest_a, "head")
    assert remote_anchor(guest_a,expected_streams=4) == anchors[0]
    print("PASS: real Xray kill and replacement fail closed, peer unaffected, exact WAL and both signed PostgreSQL outboxes survived database restart; no refund or public ingress.")
