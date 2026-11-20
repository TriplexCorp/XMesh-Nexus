#!/usr/bin/env python3
"""INDEPENDENT Nexus verifier for Node's NON-AUTHORIZING rollover PREPARE.

This is NOT an HTTP route, Nexus acknowledgment, Xray-unfreeze instruction,
settlement caller or final meter proof. It cannot debit or refund anything.
It must never accept a journal fingerprint supplied *only* inside a receipt:
the expected hash comes from the caller's separately trusted audit context,
and the signed Node statement is cross-checked against it. Nexus does not
currently verify remote kernel writer completion or authorize new admission.

No XMesh-Node code is imported by this independent verifier.
"""
import hashlib

import quota_v2_stop_chain_audit as stop

DOMAIN=b"XMESH_QUOTA_V2_CONSERVATIVE_ROLLOVER_PREPARE_V1\x00"
KIND="xmesh.quota-v2.conservative-rollover-prepare"
SCOPE=stop.SCOPE
FLAGS=("absoluteCarryforwardVerified","nexusAcknowledged",
       "rolloverAuthorized","finalMeterVerified","settlementEligible")
PROPOSAL_FIELDS=(*SCOPE,"schemaVersion","kind","oldRuntimeId",
    "oldContainerId","oldStartedAt","observationSha256","stopChainSha256",
    "xrayJournalSha256","nodeDurableAbsoluteFloorBytes",
    "oldRuntimeObservedUplinkBytes","oldRuntimeObservedDownlinkBytes",
    "inboundMeters",*FLAGS,"refundableBytes")


def verify_nonfinal_rollover_prepare(raw_observation, raw_stop,
                                      raw_prepare, enrolled_node_public_key,
                                      expected_db_scope,
                                      trusted_db_inbound_emails,
                                      independently_supplied_wal_sha256):
    """Audit three source signatures with database scope and external digest.

    Never sum the signed Node cumulative absolute floor with the Xray raw
    bytes. They can overlap! The result is informational only and always
    says no automatic resume/settlement/refund is authorized.
    """
    if (not isinstance(independently_supplied_wal_sha256,str) or
            stop.HEX64.fullmatch(independently_supplied_wal_sha256) is None):
        raise ValueError("trusted old-Xray journal fingerprint is required")
    verified_stop=stop.verify_nonfinal_stop_chain(
        raw_observation,raw_stop,enrolled_node_public_key,
        expected_db_scope,trusted_db_inbound_emails)
    original=stop._decode(raw_observation)
    stopped=stop._decode(raw_stop)
    envelope=stop._decode(raw_prepare)
    stop._envelope(envelope,"conservative rollover prepare")
    p=envelope["payload"]
    stop._exact(p,PROPOSAL_FIELDS,"conservative rollover prepare")
    cp=original["payload"]["checkpoint"]
    sp=stopped["payload"]
    if (type(p["schemaVersion"]) is not int or p["schemaVersion"]!=1 or
            p["kind"]!=KIND or
            not all(type(p[k]) is bool and p[k] is False for k in FLAGS) or
            type(p["refundableBytes"]) is not int or
            p["refundableBytes"]!=0):
        raise ValueError("Node attempted to promote nonfinal rollover into authorization")
    for field in SCOPE:
        if (p[field]!=expected_db_scope[field] or
                type(p[field]) is not type(expected_db_scope[field]) or
                p[field]!=sp[field] or p[field]!=cp[field]):
            raise ValueError("signed rollout request does not match trusted reservation")
    for target, source in (
        ("oldRuntimeId","oldRuntimeId"),
        ("oldContainerId","oldContainerId"),
        ("oldStartedAt","oldStartedAt"),
        ("xrayJournalSha256","xrayJournalSha256"),
    ):
        if p[target]!=sp[source] or type(p[target]) is not type(sp[source]):
            raise ValueError("rollover was signed for a different old Xray process")
    if (p["xrayJournalSha256"]!=independently_supplied_wal_sha256 or
            p["xrayJournalSha256"]!=verified_stop["nodeAttestedXrayJournalSha256"]):
        raise ValueError("Xray WAL digest differs from signed stop and trusted audit")
    if (p["observationSha256"]!=hashlib.sha256(raw_observation).hexdigest() or
            p["stopChainSha256"]!=hashlib.sha256(raw_stop).hexdigest()):
        raise ValueError("rollover refers to an unknown signed original record")
    signed_floor=stop._meter(original["payload"]["durableAbsoluteFloorBytes"],
                             "signed Node durable account floor")
    if (type(p["nodeDurableAbsoluteFloorBytes"]) is not int or
            p["nodeDurableAbsoluteFloorBytes"]!=signed_floor):
        raise ValueError("claimed absolute Node floor was substituted")
    raw_up=stop._meter(cp["uplinkBytes"],"Xray uplink")
    raw_down=stop._meter(cp["downlinkBytes"],"Xray downlink")
    if (raw_up+raw_down>stop.MAX_METER or
            type(p["oldRuntimeObservedUplinkBytes"]) is not int or
            type(p["oldRuntimeObservedDownlinkBytes"]) is not int or
            p["oldRuntimeObservedUplinkBytes"]!=raw_up or
            p["oldRuntimeObservedDownlinkBytes"]!=raw_down):
        raise ValueError("rollover account precharged byte count mismatches observation")
    if (not isinstance(p["inboundMeters"],list) or
            len(p["inboundMeters"])!=len(trusted_db_inbound_emails) or
            len(p["inboundMeters"])!=len(cp["inboundMeters"])):
        raise ValueError("rollover omitted a signed configured inbound")
    for index, alias in enumerate(trusted_db_inbound_emails):
        row=p["inboundMeters"][index]
        original_row=cp["inboundMeters"][index]
        stop._exact(row,("email","uplinkBytes","downlinkBytes"),
                    "rollover per-inbound amount")
        if (row["email"]!=alias or row["email"]!=original_row["email"] or
                row["uplinkBytes"]!=original_row["uplinkBytes"] or
                row["downlinkBytes"]!=original_row["downlinkBytes"]):
            raise ValueError("rollover lost a configured main/CDN meter")
        for direction in ("uplinkBytes","downlinkBytes"):
            if (type(row[direction]) is not int or
                    type(original_row[direction]) is not int):
                raise ValueError("rollover byte count has unsafe numeric type")
            stop._meter(row[direction],"rollover inbound byte count")
    stop._verify_ed25519(p,envelope["signature"],DOMAIN,enrolled_node_public_key)
    # No SQL mutation, no Xray runtime integration, and no inferred final
    # byte proof. A separate Nexus-signed durable ACK and exactly-once
    # absolute ledger (NOT in this module) are required to unblock a user.
    return {
        "authenticatedNodeId": expected_db_scope["nodeId"],
        "authenticatedSignedReservation":True,
        "nodePreparedConservativeRollover":True,
        "sourceStopAndObservationSignaturesVerified":True,
        "sourceJournalHashMatchedIndependentInput":True,
        "nodeDurableAbsoluteFloorBytesForAudit":signed_floor,
        "oldRuntimeObservedBytesForAudit":raw_up+raw_down,
        "proposalSha256":hashlib.sha256(raw_prepare).hexdigest(),
        "canApplyRollover":False,
        "nexusAcknowledged":False,
        "finalMeterVerified":False,
        "settlementEligible":False,
        "refundableBytes":0,
    }
