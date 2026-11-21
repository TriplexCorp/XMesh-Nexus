"""Actual installed 6.0.27 Agent + real Xray + PostgreSQL signed cap rehearsal.

Run ONLY from the controlled disposable systemd harness. There is NO public
or production ingress. The trusted hosted runner owns both guests and stages
the original SQL cap after independent process/WAL observations.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

LEASE_PATH = "/api/v1/node/quota-v2/genesis-reservation"
CAP_PATH = "/api/v1/node/quota-v2/genesis-cap-delivery"
CAP_DOMAIN = b"XMESH_QUOTA_V2_XRAY_CAP_ADMISSION_V1\0"
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
    image=os.environ["XMESH_WAL_XRAY_IMAGE"]
    assert re.fullmatch(r"sha256:[a-f0-9]{64}",image)
    archive=root/"xray-image.tar"
    lab.docker("image","save","-o",archive,image)
    digest=os.environ["XMESH_WAL_XRAY_SHA256"]
    public=subprocess.check_output(["openssl","pkey","-pubin",
        "-in",os.environ["XMESH_TEST_POLICY_PUBLIC_KEY"],"-outform","DER"],timeout=5)[-32:].hex()

    def load(guest):
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
        actual=[x for x in p["config"]["inbounds"] if x["tag"]==tag]
        assert len(actual)==1
        clients=actual[0]["settings"]["clients"]
        assert len(clients)==1 and clients[0]["email"]==f"xmesh-u{uid}--{tag}"
        assert clients[0]["id"]==user["xrayId"]
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
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.000000001,"period":"daily"}},
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
    print("Independent Node and CDN limits cannot silently become shared bootstrap grants.")

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
        path=root/f"actual-profile-{guest.node}.json"
        path.write_bytes(raw)
        return observed,path

    def probe(item,ceiling,observed,tag):
        guest,_,_=item
        raw=guest.exec("nsenter","--target",str(observed[2]),"--net","--",
                       "python3",MEASURED+"/live-vless.py",MEASURED+"/xray-client",
                       user["xrayId"],f"xmesh-u{uid}--{tag}",str(ceiling),timeout=48)
        return json.loads(raw)

    measurements=parallel(measure,stages)
    before=parallel(lambda job:probe(job[0],0,job[1][0],job[2]),
                    zip(stages,measurements,tags))
    assert before==[{"uplink":0,"downlink":0}]*2
    # The CI host owns the disposable guest/root. It directly reads the
    # measured kernel process and private WAL directory, not a Node claim.
    # Verify both original isolated processes have no historic WAL or cap.
    for (guest,_,_),_ in zip(stages,measurements):
        names=guest.exec("ls","-1A",MEASURED+"/wal").decode().splitlines()
        assert not any(n.startswith(("meter-","positive-cap-")) for n in names),names
        assert db.execute("SELECT count(*) FROM quota_v2_external_wal_birth_anchors WHERE node_id=%s",
                          (guest.node,)).fetchone()==(0,)

    cap_jobs=[]
    for item,measurement,saved in zip(stages,measurements,confirmed):
        guest,req,_=item
        observed,path=measurement
        container,_,pid,runtime=observed
        payload=saved[1]["payload"]
        lease=payload["reservation"]
        nonce=secrets.token_hex(32)
        cap_request={"nodeId":guest.node,"userId":uid,"requestChallenge":nonce}
        assert guest.request(CAP_PATH,cap_request)[0]==409, "unstaged cap accessible"
        preflight=db.execute(
            "SELECT authorized_bytes,can_start,can_resume,final_meter_verified,refundable_bytes "
            "FROM quota_v2_record_quarantined_runtime_preflight("
            "%s,%s::uuid,%s,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s)",
            (uid,lease["epoch"],guest.node,lease["meterEpoch"],lease["reservationId"],
             lease["revision"],nonce,runtime,container,pid,req["policySha256"],
             payload["activationReceiptSha256"],0)).fetchone()
        assert preflight==(0,False,False,False,0)
        signed=json.loads(subprocess.check_output(
            [os.environ["XMESH_CI_CAP_SIGNER"],"--installed",str(guest.node),str(uid),
             nonce,str(pid),container,req["policySha256"],str(path)],timeout=20))
        grant=signed["signedEnvelope"].encode()
        assert signed["publicKeyHex"]==public
        cap=json.loads(grant)
        independent_signature(root,f"cap-{guest.node}",cap,CAP_DOMAIN)
        assert cap["payload"]["sharedCeilingBytes"]==lease["ceilingBytes"]
        assert cap["payload"]["runtimeId"]==runtime
        assert db.execute("SELECT signed_envelope FROM quota_v2_signed_first_cap_outbox "
                          "WHERE node_id=%s AND request_challenge=%s",
                          (guest.node,nonce)).fetchone()[0]==grant
        cap_jobs.append((item,measurement,cap_request,grant,lease["ceilingBytes"]))

    assert guest_a.request(CAP_PATH,cap_jobs[1][2])[0]==401
    assert guest_a.request(CAP_PATH,dict(cap_jobs[0][2],requestChallenge=cap_jobs[1][2]["requestChallenge"]))[0]==409

    # Even already signed outbox bytes may not be delivered after the
    # owner's plan has changed. These checks must not consume or renew them.
    original_caps=db.execute(
        "SELECT node_id,request_challenge,signed_envelope FROM quota_v2_signed_first_cap_outbox ORDER BY node_id"
    ).fetchall()
    owner.request("PATCH",user_path,{
        "nodeTrafficLimits":{str(guest_a.node):{"limitGb":0.000000001,"period":"daily"}},
        "cdnLimitGb":0.000000001,
    })
    try:
        assert guest_a.request(CAP_PATH,cap_jobs[0][2])[0]==409
        assert guest_b.request(CAP_PATH,cap_jobs[1][2])[0]==409
        assert db.execute("SELECT node_id,request_challenge,signed_envelope "
                          "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id").fetchall()==original_caps
    finally:
        owner.request("PATCH",user_path,{"nodeTrafficLimits":{},"cdnLimitGb":0})

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
                          "FROM quota_v2_signed_first_cap_outbox ORDER BY node_id").fetchall()==original_caps
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
        receipt=json.loads(guest.exec(*cmd,timeout=48))
        assert receipt=={"runtimeId":measurement[0][3],
                         "grantSha256":hashlib.sha256(grant).hexdigest()}
        saved=json.loads(guest.exec("cat",STATE+f"/genesis-positive-cap-u{uid}.json"))
        assert saved["signedEnvelope"].encode()==grant
        stored=guest.exec("cat",MEASURED+f"/wal/positive-cap-u{uid}.json")
        assert stored==grant
        return cmd

    commands=parallel(install,cap_jobs)
    assert db.execute("SELECT count(*) FROM quota_v2_signed_first_cap_outbox").fetchone()==(2,)
    results=parallel(lambda value:probe(value[0][0],value[0][4],
                                       value[0][1][0],value[1]),zip(cap_jobs,tags))
    assert sum(sum(result.values()) for result in results)==account[0]
    wal_snapshots=[]
    for job,tag,result in zip(cap_jobs,tags,results):
        item,measurement,_,grant,ceiling=job
        guest,_,_=item
        assert sum(result.values())==ceiling
        runtime=measurement[0][3]
        snapshot={}
        for direction in ("uplink","downlink"):
            key=f"{runtime}\0xmesh-u{uid}--{tag}\0{direction}".encode()
            path=MEASURED+"/wal/meter-"+hashlib.sha256(key).hexdigest()+".jsonl"
            raw=guest.exec("cat",path)
            assert json.loads(raw.splitlines()[-1])["nextBytes"]==result[direction]
            snapshot[path]=raw
        wal_snapshots.append(snapshot)
    print("Both installed Agents fetched genuine Nexus-signed PostgreSQL caps via strict XSP/2, applied them to real Xray, and VLESS/StatsService/WAL exhausted exactly conserved shared bytes.")
    # A repeat cannot extend/reinstall the existing positive cap.
    repeated=subprocess.run(["docker","exec",guest_a.name,*commands[0]],
                             capture_output=True,timeout=35)
    assert repeated.returncode!=0, "positive cap replay was admitted twice"
    outbox_sql="SELECT node_id,request_challenge,signed_envelope FROM quota_v2_signed_first_cap_outbox ORDER BY node_id"
    committed_caps=db.execute(outbox_sql).fetchall()
    assert len(committed_caps)==2

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
    replacement=measure(stages[0],replacement=True)[0]
    assert replacement[0]!=measurements[0][0][0]
    failed=subprocess.run(["docker","exec",guest_a.name,*commands[0]],
                          capture_output=True,timeout=35)
    assert failed.returncode!=0, "old grant accepted by replacement Xray"
    assert probe(stages[0],0,replacement,tags[0])=={"uplink":0,"downlink":0}
    assert all(guest_a.exec("cat",path)==raw for path,raw in wal_snapshots[0].items())
    ledger_sql="SELECT node_id,stage,signed_reply FROM quota_v2_genesis_lease_replies ORDER BY node_id,stage"
    ledger=db.execute(ledger_sql).fetchall()
    assert len(ledger)==4
    db=lab.restart_postgres(stack,dsn,db)
    assert db.execute(ledger_sql).fetchall()==ledger
    assert db.execute(outbox_sql).fetchall()==committed_caps
    assert db.execute(lease_sql,(uid,)).fetchall()==rows
    for guest,snapshot in zip(pair,wal_snapshots):
        assert all(guest.exec("cat",path)==raw for path,raw in snapshot.items())
    print("PASS: real Xray kill and replacement fail closed, peer unaffected, exact WAL and both signed PostgreSQL outboxes survived database restart; no refund or public ingress.")
