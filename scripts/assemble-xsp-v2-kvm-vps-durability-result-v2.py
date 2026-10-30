#!/usr/bin/env python3
import argparse, json, hashlib, tarfile, gzip, shutil
from pathlib import Path

CRASH = {
    "after-previous":"726d06d7757dd1a2e46d96a106d5a78144d780a5ab883da255d5b487c724263d",
    "after-floor":"73ef32336d6190e636f322d5e4dbe320ddd0168c2aa4fc813d585b94fb45ad72",
    "after-active":"1719e950bf40104980c4f0bb46f2034aa0ab3dfc0b1cc071f590a7e2c1e064f9",
    "after-recovery-abort":"aa5fe427c4cc360aa654f522bb16698872558e1c6176fd2a8244d9b6eb7404d3",
    "after-recovery-active":"9c52db6d5d14a95962044e1ba148339d3714279ac0482dba50a830748b2ab428",
}
OFFHOST = {
    "nodeId":13,
    "checkpointSha256":"bc730df3a2078027cc4cbb4982da622dc8970dd49796fd9cbc0566a6364a3069",
    "receiptSha256":"daf40d33fa63d35f6f02fbcae417c4f4a4262d31bd9a0d1f11493ca018925ae9",
    "verificationResultSha256":"4de873d0a5e9f85d245a9c880c0f75884117875888b5aedee4d4934cd64c5569",
    "verificationStatus":"verified","minimumEpoch":2,"localEpoch":2,
}
TOOL = {
    "nodeRevision":"3e3b5aa80d3d3e6b3729805ea6cb3092f3103abb",
    "runtimeBaseRevision":"34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb",
    "runnerPath":"security/xspv2/poc-go/cmd/xspv2-kvm-qualify/main.go",
    "buildTag":"xspv2_powercut_qualification",
    "binarySha256":"4dae3081d270a721d5f91265063327e130c2a9fe7c2a959847bf363adc7edab2",
}

def load(p):
    with open(p, encoding="utf-8") as f: return json.load(f)

def sha256(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""): h.update(c)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--dir",default="/root")
    a=ap.parse_args(); root=Path(a.dir)
    idx=load(root/"node13-final-five-run-index.json")
    pg=load(root/"xspv2-postgres-crash-recovery-node13.json")
    acc=load(root/"xspv2-provider-storage-acceptance.json")
    runs=[]
    for r in idx["runs"]:
        runs.append({
            "runId":r["runId"],"checkpoint":r["checkpoint"],"crashMethod":"guest-kernel-panic",
            "crashEvidenceSha256":CRASH[r["checkpoint"]],"bootBeforeId":r["bootBeforeId"],
            "bootAfterId":r["bootAfterId"],"nodeId":r["nodeId"],"rotation":r["rotation"],
            "postBoot":{"classification":r["classification"],"keyEpoch":r["keyEpoch"],
            "activeEdKeyId":r["activeEdKeyId"],"activePQKeyId":r["activePQKeyId"],
            "securityStateSha256":r["securityStateSha256"],
            "networkAttemptedBeforeValidation":r["networkAttemptedBeforeValidation"]}
        })
    off=root/"xspv2-offhost-witness-v2.json"
    off.write_text(json.dumps(OFFHOST,sort_keys=True,separators=(",",":"))+"\n")
    arc=root/"xspv2-kvm-evidence-v2.tar.gz"
    names=["node13-final-five-run-index.json","node13-final-five-run-evidence.tar.gz",
           "xspv2-postgres-crash-recovery-node13.json","xspv2-provider-storage-acceptance.json",
           "xspv2-offhost-witness-v2.json"]
    with open(arc,"wb") as raw:
        with gzip.GzipFile(fileobj=raw,mode="wb",mtime=0) as gz:
            with tarfile.open(fileobj=gz,mode="w") as tf:
                for n in sorted(names):
                    p=root/n; ti=tf.gettarinfo(str(p),arcname=n); ti.mtime=1793318400; ti.uid=ti.gid=0; ti.uname=ti.gname=""
                    with open(p,"rb") as f: tf.addfile(ti,f)
    result={
        "schema":"xsp2-kvm-vps-durability-qualification-result-2","deploymentClass":"kvm-vps",
        "topology":{"nodeStateScope":"isolated-qualification-keyring","nodeFailureDomain":"node13-datagio-kvm",
        "nexusPostgresFailureDomain":"nexus-postgres-play2go-kvm","separateFailureDomains":True},
        "target":{"nexusRevision":"12b3170996bc062ee16c79659a6378e5e425fd0e","nodeRevision":"34d3d7ef5b88fb62e0d7ffa70d92b9aafa3a3abb"},
        "qualificationTooling":TOOL,"subjectNodeId":13,
        "evidenceBundle":{"archiveName":arc.name,"archiveSha256":sha256(arc)},
        "providerStorage":{"node":acc["node"],"nexusPostgres":acc["nexusPostgres"]},
        "nodeRuns":runs,"postgresCrashRecovery":pg,"offhostProductionWitness":OFFHOST,
        "claims":{"guestCrashConsistencyQualified":True,"providerStorageDurabilityAssumed":True,
        "physicalPowerLossQualified":False,"productionActivation":False,"strictPQEnabled":False}
    }
    out=root/"kvm-vps-durability-result-v2.json"
    out.write_text(json.dumps(result,sort_keys=True,separators=(",",":"))+"\n")
    print(json.dumps({"archive":str(arc),"archiveSha256":sha256(arc),"result":str(out),"resultSha256":sha256(out)},sort_keys=True))
if __name__=="__main__": main()
