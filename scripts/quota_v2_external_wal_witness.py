#!/usr/bin/env python3
"""Independent Nexus-side Node WAL-birth witness verifier + durable recorder.

This stage is OFFLINE/CI-ONLY. It does not import any XMesh-Node verifier,
and has NO production API route, Xray re-admission, quota debit or refund.
A signed FULL WAL birth index is authenticated against the enrolled Node
Ed25519 key, independently parsed into an exact Go-format, gapless hash
chain, and stored atomically off-node as full immutable UTF-8 bytes in
PostgreSQL. Every successive snapshot MUST extend the original bytes.

An initial off-node witness is a bootstrap only. No one can retroactively
prove no old files were deleted before that very first remote witness.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

from psycopg.pq import TransactionStatus

import quota_v2_stop_chain_audit as signed

DOMAIN=b"XMESH_QUOTA_V2_OFFHOST_WAL_BIRTH_WITNESS_V1\x00"
NEXUS_DOMAIN=b"XMESH_QUOTA_V2_REMOTE_WAL_BIRTH_STORED_V1\x00"
KIND="xmesh.quota-v2.offhost-wal-birth-witness"
NEXUS_KIND="xmesh.quota-v2.external-wal-birth-stored"
INDEX_FIELDS=("schemaVersion","sequence","filename","runtimeId",
              "email","direction","firstWalDigest","previousDigest","digest")
WITNESS_FIELDS=("schemaVersion","kind","nodeId","oldContainerId",
                "oldStartedAt","inventorySequence","inventorySha256",
                "inventoryTailDigest","indexedWalCount",
                "localBirthsIndependentlyChecked","nexusPersisted",
                "carryforwardApplied","canResume","finalMeterVerified",
                "refundableBytes")
ACK_FIELDS=("schemaVersion","kind","nodeId","inventorySequence",
            "inventorySha256","inventoryTailDigest","originalNodeWitnessSha256",
            "oldContainerId","oldStartedAt","offhostFullIndexCommitted",
            "bootstrapOnly","canResume","carryforwardApplied",
            "finalMeterVerified","refundableBytes")
MAX_INDEX=4 << 20
MAX_ENTRIES=4096
HEX64=re.compile(r"[0-9a-f]{64}\Z")
EMAIL=re.compile(r"xmesh-u([1-9][0-9]{0,18})--([^\x00-\x20>]{1,128})\Z")


def _go(line):
    return json.dumps(line,ensure_ascii=False,allow_nan=False,
                      separators=(",",":")).encode("utf-8")+b"\n"


def verify_signed_node_birth_witness(raw_witness, raw_registry,
                                    independent_node_id, enrolled_node_pubkey):
    """No claimed key from the incoming document can replace enrollment."""
    if (not isinstance(raw_registry,bytes) or
            not 0<len(raw_registry)<=MAX_INDEX or
            not raw_registry.endswith(b"\n") or
            not isinstance(independent_node_id,int) or
            type(independent_node_id) is not int or independent_node_id<=0):
        raise ValueError("missing complete canonical remote Xray birth index")
    doc=signed._decode(raw_witness)
    signed._envelope(doc,"Node WAL birth witness")
    p=doc["payload"]
    signed._exact(p,WITNESS_FIELDS,"Node WAL witness")
    if (type(p["schemaVersion"]) is not int or p["schemaVersion"]!=1 or
            p["kind"]!=KIND or
            type(p["nodeId"]) is not int or
            p["nodeId"]!=independent_node_id or
            type(p["inventorySequence"]) is not int or
            not 1<=p["inventorySequence"]<=MAX_ENTRIES or
            type(p["indexedWalCount"]) is not int or
            p["indexedWalCount"]!=p["inventorySequence"] or
            p["localBirthsIndependentlyChecked"] is not True or
            p["nexusPersisted"] is not False or
            p["carryforwardApplied"] is not False or
            p["canResume"] is not False or
            p["finalMeterVerified"] is not False or
            type(p["refundableBytes"]) is not int or
            p["refundableBytes"]!=0):
        raise ValueError("forged final/authorizing Node WAL witness")
    for field in ("oldContainerId","inventorySha256","inventoryTailDigest"):
        value=p[field]
        if not isinstance(value,str) or HEX64.fullmatch(value) is None:
            raise ValueError("invalid Node Xray witness digest")
    if (not isinstance(p["oldStartedAt"],str) or
            not 15<=len(p["oldStartedAt"])<=64 or
            "T" not in p["oldStartedAt"]):
        raise ValueError("invalid Node Xray container timestamp")
    if p["inventorySha256"]!=hashlib.sha256(raw_registry).hexdigest():
        raise ValueError("remote Xray index changed after Node Ed25519 signature")

    lines=raw_registry[:-1].split(b"\n")
    if len(lines)!=p["inventorySequence"]:
        raise ValueError("partial or unbounded off-host Xray index")
    previous="0"*64
    names=set()
    for index,line in enumerate(lines):
        if not 0<len(line)<=1024:
            raise ValueError("unbounded remote WAL birth record")
        try:
            item=json.loads(
                line.decode("utf-8"),object_pairs_hook=signed._pairs,
                parse_constant=lambda _: (_ for _ in ()).throw(
                    ValueError("untrusted birth index number")))
        except (UnicodeError,ValueError) as exc:
            raise ValueError("malformed remote birth index record") from exc
        if (not isinstance(item,dict) or
                tuple(item)!=INDEX_FIELDS or
                _go(item)!=line+b"\n" or
                type(item["schemaVersion"]) is not int or
                item["schemaVersion"]!=1 or
                type(item["sequence"]) is not int or
                item["sequence"]!=index+1 or
                item["previousDigest"]!=previous):
            raise ValueError("replayed or noncanonical remote Xray birth sequence")
        run=item["runtimeId"]
        email=item["email"]
        direction=item["direction"]
        first=item["firstWalDigest"]
        digest=item["digest"]
        if (not isinstance(run,str) or HEX64.fullmatch(run) is None or
                not isinstance(email,str) or EMAIL.fullmatch(email) is None or
                any(ch in email for ch in "<>&") or
                direction not in ("uplink","downlink") or
                not isinstance(first,str) or HEX64.fullmatch(first) is None or
                not isinstance(digest,str) or HEX64.fullmatch(digest) is None or
                not isinstance(item["filename"],str)):
            raise ValueError("invalid remote birth source identity")
        filename="meter-"+hashlib.sha256(
            (run+"\x00"+email+"\x00"+direction).encode("utf-8")
        ).hexdigest()+".jsonl"
        if filename!=item["filename"] or filename in names:
            raise ValueError("duplicate or reassigned Xray WAL filename")
        baseline=dict(item)
        baseline["digest"]=""
        if digest!=hashlib.sha256(_go(baseline)).hexdigest():
            raise ValueError("rehashed or fabricated remote WAL birth linkage")
        names.add(filename)
        previous=digest
    if previous!=p["inventoryTailDigest"]:
        raise ValueError("off-host index tail differs from signed Node witness")
    signed._verify_ed25519(p,doc["signature"],DOMAIN,enrolled_node_pubkey)
    # Node's local Go/Python verifier checked actual WALs before signing,
    # but Nexus independently has only the full birth index bytes; it has
    # not read arbitrary VPS fsync or transmitted-byte reality itself.
    return {
        "nodeId":independent_node_id,
        "inventorySequence":p["inventorySequence"],
        "inventorySha256":p["inventorySha256"],
        "inventoryTailDigest":p["inventoryTailDigest"],
        "originalNodeWitnessSha256":hashlib.sha256(raw_witness).hexdigest(),
        "oldContainerId":p["oldContainerId"],
        "oldStartedAt":p["oldStartedAt"],
        "fullIndexSignatureVerified":True,
        "remoteWALBytesIndependentlyRead":False,
        "canResume":False,
        "finalMeterVerified":False,
        "refundableBytes":0,
    }


def _sign_nexus(root_private_key,payload):
    fd=os.open(root_private_key,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        st=os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or
                st.st_uid!=os.geteuid() or
                stat.S_IMODE(st.st_mode)!=0o600 or st.st_nlink!=1):
            raise ValueError("unsafe Nexus external witness signing key")
        with tempfile.TemporaryDirectory(prefix="xmesh-nexus-wal-birth-") as root:
            inp=Path(root)/"message"
            inp.write_bytes(NEXUS_DOMAIN+signed._canonical(payload))
            proc=subprocess.run(
                ["openssl","pkeyutl","-sign","-rawin","-in",str(inp),
                 "-inkey","/proc/self/fd/"+str(fd)],
                capture_output=True,pass_fds=(fd,),check=False,timeout=10)
            if proc.returncode or len(proc.stdout)!=64:
                raise ValueError("Nexus WAL witness signature unavailable")
            return proc.stdout.hex()
    finally:
        os.close(fd)


def verify_nexus_committed_birth_ack(raw_ack,raw_node_witness,raw_index,
                                     trusted_node, trusted_node_pub,
                                     enrolled_nexus_pub):
    """Verify that Nexus SIGNED this specific external full-index milestone.

    Still no user release. A separate trusted PostgreSQL fetch is required
    when using a receipt to make operational recovery decisions. The receipt
    alone does not attest current live Xray process or active remote role.
    """
    verified=verify_signed_node_birth_witness(
        raw_node_witness,raw_index,trusted_node,trusted_node_pub)
    ack=signed._decode(raw_ack)
    signed._envelope(ack,"Nexus full birth-index registration")
    p=ack["payload"]
    signed._exact(p,ACK_FIELDS,"Nexus signed birth-index registration")
    if (type(p["schemaVersion"]) is not int or p["schemaVersion"]!=1 or
            p["kind"]!=NEXUS_KIND or
            p["nodeId"]!=trusted_node or type(p["nodeId"]) is not int or
            type(p["inventorySequence"]) is not int or
            p["inventorySequence"]!=verified["inventorySequence"] or
            type(p["bootstrapOnly"]) is not bool or
            p["offhostFullIndexCommitted"] is not True or
            p["canResume"] is not False or
            p["carryforwardApplied"] is not False or
            p["finalMeterVerified"] is not False or
            type(p["refundableBytes"]) is not int or p["refundableBytes"]!=0):
        raise ValueError("Nexus witness cannot authorize Xray quota rollover")
    for field in ("inventorySha256","inventoryTailDigest",
                  "originalNodeWitnessSha256","oldContainerId",
                  "oldStartedAt"):
        if p[field]!=verified[field] or type(p[field]) is not type(verified[field]):
            raise ValueError("Nexus external witness from foreign Node/process")
    signed._verify_ed25519(p,ack["signature"],NEXUS_DOMAIN,enrolled_nexus_pub)
    return {
        "nexusSignedExternalBirthIndex":True,
        "externalFirstWitnessBootstrapOnly":p["bootstrapOnly"],
        "nodeWitnessSequence":p["inventorySequence"],
        "nodeWitnessSha256":p["originalNodeWitnessSha256"],
        "canResume":False,"finalMeterVerified":False,"refundableBytes":0,
    }


def commit_external_index(conn,raw_node_witness,raw_registry,
                          enrolled_node_public_key, trusted_node_id,
                          root_nexus_private_key, enrolled_nexus_pub):
    """Require an idle autocommit connection and commit before signing.

    An explicit caller transaction is possible even in autocommit mode.
    Require an idle connection so our transaction cannot become a savepoint.
    """
    if (conn.autocommit is not True or
            conn.info.transaction_status != TransactionStatus.IDLE):
        raise ValueError("Nexus external witness requires idle autocommit SQL")
    v=verify_signed_node_birth_witness(
        raw_node_witness,raw_registry,trusted_node_id,enrolled_node_public_key)
    with conn.transaction():
        # Flush the commit WAL even when the session defaults to async commit.
        conn.execute("SET LOCAL synchronous_commit TO on")
        row=conn.execute(
            "SELECT * FROM quota_v2_store_external_wal_birth_anchor("
            "%s,%s,%s,%s,%s,%s,%s,%s)",
            (trusted_node_id,v["inventorySequence"],v["inventorySha256"],
             v["inventoryTailDigest"],v["originalNodeWitnessSha256"],
             v["oldContainerId"],v["oldStartedAt"],raw_registry)).fetchone()
        if row is None:
            raise ValueError("no committed remote WAL birth index")
    # Re-read the persisted full bytes after COMMIT and before signing.
    loaded=conn.execute(
        "SELECT inventory_sequence,inventory_sha256,inventory_tail_digest,"
        "original_node_witness_sha256,old_container_id,old_started_at,"
        "inventory_bytes,first_external_witness "
        "FROM quota_v2_external_wal_birth_anchors "
        "WHERE node_id=%s AND inventory_sequence=%s",
        (trusted_node_id,v["inventorySequence"])).fetchone()
    if (loaded is None or
            (loaded[0],loaded[1],loaded[2],loaded[3],loaded[4],loaded[5])!=(
                v["inventorySequence"],v["inventorySha256"],
                v["inventoryTailDigest"],v["originalNodeWitnessSha256"],
                v["oldContainerId"],v["oldStartedAt"]) or
            bytes(loaded[6])!=raw_registry or type(loaded[7]) is not bool):
        raise ValueError("Nexus WAL witness DB did not retain complete signed data")
    p={
        "schemaVersion":1,"kind":NEXUS_KIND,"nodeId":trusted_node_id,
        "inventorySequence":v["inventorySequence"],
        "inventorySha256":v["inventorySha256"],
        "inventoryTailDigest":v["inventoryTailDigest"],
        "originalNodeWitnessSha256":v["originalNodeWitnessSha256"],
        "oldContainerId":v["oldContainerId"],
        "oldStartedAt":v["oldStartedAt"],
        "offhostFullIndexCommitted":True,
        "bootstrapOnly":loaded[7],
        "canResume":False,"carryforwardApplied":False,
        "finalMeterVerified":False,"refundableBytes":0,
    }
    result={
        "algorithm":"Ed25519","payload":p,
        "signature":_sign_nexus(root_nexus_private_key,p),
    }
    raw=signed._canonical(result)+b"\n"
    verify_nexus_committed_birth_ack(
        raw,raw_node_witness,raw_registry,trusted_node_id,
        enrolled_node_public_key,enrolled_nexus_pub)
    return raw
