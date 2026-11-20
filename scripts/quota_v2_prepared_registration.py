#!/usr/bin/env python3
"""CI-only Nexus-signed receipt: this nonfinal rollover was RECORDED, not APPLIED.

No HTTP endpoint, production signer, quota mutation, Xray admission action,
carryforward calculation or terminal settlement is implemented here.

Signing requires independently verified Node evidence AND an existing,
immutable PostgreSQL stage-0133 row matching every exact scope/hash/amount.
An arbitrary Ed25519 Node receipt (or caller-supplied claimed database row)
cannot mint an acknowledgment. The Nexus signing key must be externally
provisioned in this isolated fixture, never shipped with the application.
"""
import fcntl
import hashlib
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tempfile

import quota_v2_stop_chain_audit as stop
import quota_v2_rollover_audit as prepared

DOMAIN=b"XMESH_QUOTA_V2_NONFINAL_PREPARE_RECORDED_V1\x00"
KIND="xmesh.quota-v2.nonfinal-prepare-recorded"
FLAGS=("absoluteCarryforwardVerified","rolloverAuthorized",
       "resumptionAllowed","finalMeterVerified","settlementEligible")
MAX_SIZE=8192
# The immutable staging row is always rendered in a stable audited order.
ROW_FIELDS=("user_id","epoch","node_id","meter_epoch","reservation_id",
            "revocation_id","applied_revision","old_xray_runtime_id",
            "old_container_id","old_started_at","proposal_sha256",
            "stop_sha256","xray_journal_sha256",
            "node_durable_absolute_floor_bytes","observed_uplink_bytes",
            "observed_downlink_bytes")
RECEIPT_FIELDS=(*stop.SCOPE,"schemaVersion","kind","oldRuntimeId",
                "oldContainerId","oldStartedAt","proposalSha256",
                "stopChainSha256","xrayJournalSha256","stagedLedgerRowSha256",
                "nodeDurableAbsoluteFloorBytes",
                "oldRuntimeObservedUplinkBytes","oldRuntimeObservedDownlinkBytes",
                "nexusRecordedPrepared",*FLAGS,"refundableBytes")


def slot_name(scope):
    stop._scope(scope)
    stable={k:scope[k] for k in ("nodeId","userId","epoch",
                                "meterEpoch","reservationId")}
    return "prepared-recorded-"+hashlib.sha256(stop._canonical(stable)).hexdigest()+".json"


def _stable_row(row):
    if row is None or len(row)!=len(ROW_FIELDS):
        raise ValueError("trusted immutable staging row missing")
    # DB-native UUID values must round-trip to exact canonical lowercase
    # strings. No caller-supplied dict is a substitute for PostgreSQL data.
    stable={}
    for name,value in zip(ROW_FIELDS,row):
        if name in ("epoch","meter_epoch","reservation_id","revocation_id"):
            value=str(value)
        stable[name]=value
    return stable


def _load_staged(conn,scope):
    # One scoped primary-key lookup from the actual database. Never take
    # a 'verified DB row' or amount from a JSON request to this function.
    row=conn.execute(
        "SELECT "+",".join(ROW_FIELDS)+
        " FROM quota_v2_nonfinal_rollover_preparations "
        "WHERE user_id=%s AND epoch=%s AND node_id=%s AND meter_epoch=%s",
        (scope["userId"],scope["epoch"],scope["nodeId"],
         scope["meterEpoch"])).fetchone()
    return _stable_row(row)


def _checked_row(staged,scope,prepared_payload,proposal_hash):
    if (staged["user_id"]!=scope["userId"] or
            staged["epoch"]!=scope["epoch"] or
            staged["node_id"]!=scope["nodeId"] or
            staged["meter_epoch"]!=scope["meterEpoch"] or
            staged["reservation_id"]!=scope["reservationId"] or
            staged["revocation_id"]!=scope["revocationId"] or
            staged["applied_revision"]!=scope["revision"] or
            staged["old_xray_runtime_id"]!=prepared_payload["oldRuntimeId"] or
            staged["old_container_id"]!=prepared_payload["oldContainerId"] or
            staged["old_started_at"]!=prepared_payload["oldStartedAt"] or
            staged["proposal_sha256"]!=proposal_hash or
            staged["stop_sha256"]!=prepared_payload["stopChainSha256"] or
            staged["xray_journal_sha256"]!=prepared_payload["xrayJournalSha256"] or
            staged["node_durable_absolute_floor_bytes"]!=prepared_payload[
                "nodeDurableAbsoluteFloorBytes"] or
            staged["observed_uplink_bytes"]!=prepared_payload[
                "oldRuntimeObservedUplinkBytes"] or
            staged["observed_downlink_bytes"]!=prepared_payload[
                "oldRuntimeObservedDownlinkBytes"]):
        raise ValueError("signed Node rollover does not match immutable Nexus stage")
    return hashlib.sha256(stop._canonical(staged)).hexdigest()


def _payload(scope,source,row_digest,proposal_hash):
    p={key:scope[key] for key in stop.SCOPE}
    p.update({
        "schemaVersion":1,"kind":KIND,
        "oldRuntimeId":source["oldRuntimeId"],
        "oldContainerId":source["oldContainerId"],
        "oldStartedAt":source["oldStartedAt"],
        "proposalSha256":proposal_hash,
        "stopChainSha256":source["stopChainSha256"],
        "xrayJournalSha256":source["xrayJournalSha256"],
        "stagedLedgerRowSha256":row_digest,
        "nodeDurableAbsoluteFloorBytes":source[
            "nodeDurableAbsoluteFloorBytes"],
        "oldRuntimeObservedUplinkBytes":source[
            "oldRuntimeObservedUplinkBytes"],
        "oldRuntimeObservedDownlinkBytes":source[
            "oldRuntimeObservedDownlinkBytes"],
        "nexusRecordedPrepared":True,
        "absoluteCarryforwardVerified":False,
        "rolloverAuthorized":False,
        "resumptionAllowed":False,
        "finalMeterVerified":False,
        "settlementEligible":False,
        "refundableBytes":0,
    })
    return p


def _check_receipt_shape(payload):
    stop._exact(payload,RECEIPT_FIELDS,"Nexus signed NONFINAL preparation")
    scope={k:payload[k] for k in stop.SCOPE}
    stop._scope(scope)
    if (type(payload["schemaVersion"]) is not int or
            payload["schemaVersion"]!=1 or
            payload["kind"]!=KIND or
            payload["nexusRecordedPrepared"] is not True or
            any(type(payload[k]) is not bool or payload[k] is not False
                for k in FLAGS) or
            type(payload["refundableBytes"]) is not int or
            payload["refundableBytes"]!=0):
        raise ValueError("Nexus NONFINAL receipt tried to authorize bytes")
    for name in ("oldRuntimeId","oldContainerId","proposalSha256",
                 "stopChainSha256","xrayJournalSha256","stagedLedgerRowSha256"):
        if not isinstance(payload[name],str) or stop.HEX64.fullmatch(payload[name]) is None:
            raise ValueError("bad Nexus receipt original proof hash")
    if (not isinstance(payload["oldStartedAt"],str) or
            not 15<=len(payload["oldStartedAt"])<=64 or
            "T" not in payload["oldStartedAt"]):
        raise ValueError("Nexus receipt not bound to original container")
    for name in ("nodeDurableAbsoluteFloorBytes",
                 "oldRuntimeObservedUplinkBytes",
                 "oldRuntimeObservedDownlinkBytes"):
        stop._meter(payload[name],name)
    if payload["oldRuntimeObservedUplinkBytes"] + payload[
            "oldRuntimeObservedDownlinkBytes"]>stop.MAX_METER:
        raise ValueError("Nexus receipt raw byte count overflow")
    return payload


def _sign(private_key,payload):
    # Keep the Nexus signing key owner-private and single linked.
    fd=os.open(private_key,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        st=os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid!=os.geteuid() or
                stat.S_IMODE(st.st_mode)!=0o600 or st.st_nlink!=1):
            raise ValueError("unsafe Nexus signing key")
        with tempfile.TemporaryDirectory(prefix="xmesh-nexus-prepared-") as root:
            inp=Path(root)/"message"
            inp.write_bytes(DOMAIN+stop._canonical(payload))
            result=subprocess.run(
                ["openssl","pkeyutl","-sign","-rawin",
                 "-in",str(inp),"-inkey","/proc/self/fd/"+str(fd)],
                capture_output=True,timeout=10,check=False,pass_fds=(fd,))
            if result.returncode or len(result.stdout)!=64:
                raise ValueError("Nexus Ed25519 NONFINAL signer failed")
            return result.stdout.hex()
    finally:
        os.close(fd)


def verify_recorded_receipt(raw, trusted_nexus_public_key,
                            expected_scope, exact_raw_node_proposal,
                            expected_staged_ledger_row_sha256):
    """Offline verifier with out-of-band Nexus pubkey and bound source hashes.

    Critically, verification only proves that Nexus SIGNED a nonauthorizing
    registration statement; it never proves the bytes were carried forward.
    """
    stop._scope(expected_scope)
    if (not isinstance(exact_raw_node_proposal,bytes) or
            not isinstance(expected_staged_ledger_row_sha256,str) or
            stop.HEX64.fullmatch(expected_staged_ledger_row_sha256) is None):
        raise ValueError("original Node proposal and independent staged row required")
    document=stop._decode(raw)
    stop._envelope(document,"Nexus prepared registration")
    p=_check_receipt_shape(document["payload"])
    original=stop._decode(exact_raw_node_proposal)
    if exact_raw_node_proposal!=stop._canonical(original)+b"\n":
        raise ValueError("Nexus receipt Node source is not canonical")
    stop._envelope(original,"Nexus receipt original Node prepare")
    src=original["payload"]
    if not isinstance(src,dict):
        raise ValueError("Nexus receipt missing Node source payload")
    if (any(p[k]!=expected_scope[k] or
            type(p[k]) is not type(expected_scope[k]) or
            p[k]!=src.get(k) for k in stop.SCOPE) or
            p["proposalSha256"]!=hashlib.sha256(exact_raw_node_proposal).hexdigest() or
            p["stagedLedgerRowSha256"]!=expected_staged_ledger_row_sha256 or
            any(p[receipt]!=src.get(source) or
                type(p[receipt]) is not type(src.get(source))
                for receipt,source in (
                  ("oldRuntimeId","oldRuntimeId"),
                  ("oldContainerId","oldContainerId"),
                  ("oldStartedAt","oldStartedAt"),
                  ("stopChainSha256","stopChainSha256"),
                  ("xrayJournalSha256","xrayJournalSha256"),
                  ("nodeDurableAbsoluteFloorBytes","nodeDurableAbsoluteFloorBytes"),
                  ("oldRuntimeObservedUplinkBytes","oldRuntimeObservedUplinkBytes"),
                  ("oldRuntimeObservedDownlinkBytes","oldRuntimeObservedDownlinkBytes")))):
        raise ValueError("Nexus receipt replay or substituted signed Node bytes")
    stop._verify_ed25519(p,document["signature"],DOMAIN,trusted_nexus_public_key)
    return p


def _private_dir(directory):
    dfd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
    info=os.fstat(dfd)
    if (not stat.S_ISDIR(info.st_mode) or
            info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=0o700):
        os.close(dfd)
        raise ValueError("untrusted Nexus receipt storage")
    return dfd


def _secure_read(dfd,name,expect_links=1):
    f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=dfd)
    try:
        info=os.fstat(f)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or
                stat.S_IMODE(info.st_mode)!=0o600 or
                info.st_nlink!=expect_links or
                not 0<info.st_size<=MAX_SIZE):
            raise ValueError("untrusted Nexus receipt file")
        data=os.read(f,MAX_SIZE+1)
        if len(data)!=info.st_size:
            raise ValueError("truncated Nexus receipt file")
        return data
    finally:
        os.close(f)


def _publish(dfd,name,raw):
    """Serialize fsync-before-link and fail closed on uncertain pending files.

    Pending entries are never erased on publication errors. No automatic
    exception handler removes a potentially fsynced but unpublished receipt.
    """
    fcntl.flock(dfd,fcntl.LOCK_EX)
    try:
        if any(x.startswith(".prepared-pending-") for x in os.listdir(dfd)):
            raise ValueError("uncertain pending Nexus registration receipt")
        try:
            before=_secure_read(dfd,name)
        except FileNotFoundError:
            before=None
        if before is not None:
            if before!=raw:
                raise ValueError("conflicting immutable Nexus receipt for one reservation")
            os.fsync(dfd)
            return
        temp=".prepared-pending-"+secrets.token_hex(16)
        fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW|
                   os.O_CLOEXEC,0o600,dir_fd=dfd)
        with os.fdopen(fd,"wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.fsync(dfd)
        os.link(temp,name,src_dir_fd=dfd,dst_dir_fd=dfd,follow_symlinks=False)
        os.fsync(dfd)
        os.unlink(temp,dir_fd=dfd)
        os.fsync(dfd)
        if _secure_read(dfd,name)!=raw:
            raise ValueError("Nexus registration receipt changed during publication")
    finally:
        fcntl.flock(dfd,fcntl.LOCK_UN)


def record_prepared_receipt(conn,raw_observation,raw_stop,raw_prepare,
                            enrolled_node_pubkey,expected_scope,
                            trusted_db_inbounds,independent_old_wal_sha256,
                            nexus_private_key,nexus_public_key,receipt_directory):
    """Generate one immutable PREPARED-ONLY receipt for an actual SQL stage.

    The signature is generated only *after* independent verification of all
    Node evidence against the exact scoped DB row. Audit-only, not API code.
    """
    verified=prepared.verify_nonfinal_rollover_prepare(
        raw_observation,raw_stop,raw_prepare,enrolled_node_pubkey,
        expected_scope,trusted_db_inbounds,independent_old_wal_sha256)
    if (verified.get("canApplyRollover") is not False or
            verified.get("settlementEligible") is not False or
            verified.get("refundableBytes")!=0):
        raise ValueError("Nexus nonfinal verification did not fail closed")
    original=stop._decode(raw_prepare)["payload"]
    digest=_checked_row(_load_staged(conn,expected_scope),expected_scope,
                        original,verified["proposalSha256"])
    payload=_payload(expected_scope,original,digest,verified["proposalSha256"])
    _check_receipt_shape(payload)
    envelope={"algorithm":"Ed25519","payload":payload,
              "signature":_sign(nexus_private_key,payload)}
    raw=stop._canonical(envelope)+b"\n"
    if len(raw)>MAX_SIZE:
        raise ValueError("signed Nexus receipt exceeds maximum size")
    verify_recorded_receipt(raw,nexus_public_key,expected_scope,
                            raw_prepare,digest)
    # Re-check DB against the same signed preparation after signing to
    # catch concurrent reservation replacement/missing staging. Existing
    # rows are immutable but database privileges may have changed.
    current=_checked_row(_load_staged(conn,expected_scope),expected_scope,
                         original,verified["proposalSha256"])
    if current!=digest:
        raise ValueError("staged Nexus row changed after signing")
    dfd=_private_dir(receipt_directory)
    try:
        _publish(dfd,slot_name(expected_scope),raw)
    finally:
        os.close(dfd)
    return raw
