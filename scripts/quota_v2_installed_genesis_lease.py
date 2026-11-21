"""Actual installed 6.0.27 Agent + real Xray + real PostgreSQL lease rehearsal.

Run ONLY from the disposable systemd harness. No public ingress or positive
cap is authorized by this test. Never use fixture identity as live authority.
"""
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess

LEASE_PATH = "/api/v1/node/quota-v2/genesis-reservation"
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
        "hold":False,"used":0,"limit":0.0015,
    })
    uid=user["id"]
    for guest,tag in zip(pair,tags):
        _,profile=owner.request("POST","/collections/profiles",{
            "name":"First Genesis "+tag,
            "config":json.dumps({
                "inbounds":[{"tag":tag,"listen":"127.0.0.1","port":28401,
                             "protocol":"vless","settings":{"decryption":"none","clients":[]},
                             "streamSettings":{"network":"tcp","security":"none"}}],
                "outbounds":[{"tag":"direct","protocol":"freedom"}],
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
        guest.exec("systemctl","stop",f"{lab.SYNC}.timer",f"{lab.SYNC}.service")
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

    for guest in pair:
        assert guest.exec("docker","inspect","-f","{{.HostConfig.NetworkMode}}",lab.XRAY).strip()==b"none"
        assert not guest.exec("docker","port",lab.XRAY).strip()
    guest_a.exec("docker","kill","--signal","KILL",lab.XRAY)
    failed=subprocess.run(["docker","exec",guest_a.name,"/usr/local/sbin/xmesh-quota-genesis-reservation",
                           *stages[0][2],"--user-id",str(uid),"--operation","confirm"],
                          capture_output=True,timeout=25)
    assert failed.returncode!=0
    assert guest_b.exec("docker","inspect","-f","{{.State.Running}}",lab.XRAY).strip()==b"true"
    ledger_sql="SELECT node_id,stage,signed_reply FROM quota_v2_genesis_lease_replies ORDER BY node_id,stage"
    ledger=db.execute(ledger_sql).fetchall()
    assert len(ledger)==4
    db=lab.restart_postgres(stack,dsn,db)
    assert db.execute(ledger_sql).fetchall()==ledger
    assert db.execute(lease_sql,(uid,)).fetchall()==rows
    print("PASS: one actual Xray killed, peer unaffected, no positive admission, exact signed reservations survived real PostgreSQL restart.")
