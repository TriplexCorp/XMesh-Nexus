#!/usr/bin/env python3
"""Disposable two-node signed API + real Node guard + PostgreSQL quota-v2 test.

This does NOT execute real Xray traffic or systemd. It exercises actual
production Nexus endpoints, Ed25519 authentication, per-node guard decisions
and persistent PostgreSQL ledgers with independent node identities.
"""
import copy, hashlib, importlib.util, json, os, subprocess, tempfile, time, uuid
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

    def metrics(self,user_id,total,lease):
        self.stats_at=max(self.stats_at+1,int(time.time()*1000))
        body={"node_id":self.id,"userStatsStatus":"verified",
              "userStatsAtMs":self.stats_at,
              "userTraffic":[{"userId":user_id,"uplinkBytes":total,"downlinkBytes":0}],
              "quotaReceipts":[{
                  "userId":user_id,"usedBytes":total,
                  **{k:lease[k] for k in ("epoch","meterEpoch","reservationId")}
              }]}
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
        a,b=nodes
        # First request prepares, but cannot activate an unacknowledged
        # offline allowance. Simulate a lost HTTP response from node A:
        # the repeated request without a durable ID must stay unfunded and
        # return the SAME reservation, not create an inaccessible new one.
        prep_a,config_a=a.desired(uid)
        prep_b,config_b=b.desired(uid)
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
        # Once Node reports a durable identity, Nexus unlocks only the
        # requested share of the account's remaining globally held capacity.
        pa,da=a.desired(uid,0,prepared_ledger_a["users"][key]["quotaReservation"])
        pb,db=b.desired(uid,0,prepared_ledger_b["users"][key]["quotaReservation"])
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
                "(SELECT COALESCE(SUM(ceiling_bytes-acknowledged_bytes),0)"
                " FROM quota_v2_reservations WHERE user_id="+str(uid)+")||','||limit_bytes"
                " FROM quota_v2_accounts WHERE user_id="+str(uid)+" AND NOT closed"
            ).split(",")))
        settled,held,limit=account()
        assert settled==0 and held==lease_a["ceilingBytes"]+lease_b["ceilingBytes"]
        assert settled+held<=limit,(settled,held,limit)
        print("PASS: concurrent node reservations conserve global quota")
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
        _,a.ledger,denied=guard.enforce(
            staged_a,sa["config"],a.ledger,{key:lease_a["ceilingBytes"]},
            "xray-a",False,staged_a["issuedAtMs"])
        assert denied.get(staged_a["users"][0]["xrayId"]) in ("quota","locally-revoked"),denied
        print("PASS: signed new epoch accepted with preserved absolute meter baseline")

        time.sleep(0.03)
        active_a,aa=a.desired(uid,lease_a["ceilingBytes"],new_a)
        active_b,bb=b.desired(uid,lease_b["ceilingBytes"],new_b)
        grant_a=active_a["users"][0]["quotaReservation"]
        grant_b=active_b["users"][0]["quotaReservation"]
        assert grant_a["ceilingBytes"]>grant_a["acknowledgedBytes"]
        assert grant_b["ceilingBytes"]>grant_b["acknowledgedBytes"]
        settled,held,limit=account()
        assert settled==0 and 0<held<=limit
        _,a.ledger,denied=guard.enforce(
            active_a,aa["config"],a.ledger,{key:lease_a["ceilingBytes"]},
            "xray-a",False,active_a["issuedAtMs"])
        assert not denied,denied
        print("PASS: reset quota issues only a newly acknowledged lease without replaying old traffic")
    print("Two-node quota-v2 API/guard/PostgreSQL acceptance: PASS")

if __name__=="__main__":
    main()
