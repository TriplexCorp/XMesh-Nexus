#!/usr/bin/env python3
"""Independent runner-side literal wire/ledger contract with real Ed25519."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid
from unittest import mock

import quota_v2_retirement_evidence as ev
from quota_v2_installed_genesis_lease import canonical


def digest(data):
    return hashlib.sha256(data).hexdigest()


def wire(doc):
    return json.dumps(doc, separators=(",", ":")).encode() + b"\n"


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="retirement-contract-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = self.root / "private.pem"
        pub = self.root / "public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519",
                        "-out", self.key], check=True, timeout=5)
        subprocess.run(["openssl", "pkey", "-in", self.key, "-pubout", "-out", pub],
                       check=True, timeout=5)
        pin = mock.patch.dict(os.environ, {"XMESH_TEST_POLICY_PUBLIC_KEY": str(pub)})
        pin.start()
        self.addCleanup(pin.stop)
        self.runtime = "a"*64
        self.node = 9
        self.expected = dict(
            nodeId=9, userId=100, runtimeId=self.runtime,
            activationReceiptSha256="1"*64, genesisPolicySha256="2"*64,
            profileRevision="3"*64, capRosterSha256="4"*64,
            containerId="b"*64, hostPid=1234, startedAt="2026-11-27T05:00:00Z",
            inventorySequence=2, inventorySha256="c"*64, inventoryTailDigest="d"*64,
            committedChargeStreamCount=2, committedChargeHeadsSha256="e"*64)
        # V2 literal full wire contract; real signer, not Node verifier.
        self.payload = dict(
            self.expected, schemaVersion=2, kind="xmesh.quota-v2.public-tls-wal-head",
            challenge="5"*64, issuedAtMs=1001, validUntilMs=8001,
            historyState="committed_birth_index", preBootstrapHistoryCompletenessVerified=False,
            liveMeterVerified=False, finalMeterVerified=False, canServePublic=False,
            canSpend=False, canStart=False, canResume=False, authorizedBytes=0, refundableBytes=0)

    def signed_record(self, payload=None, *, domain=b"XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V2\0"):
        body = self.payload if payload is None else payload
        message = self.root / "message"
        message.write_bytes(domain + canonical(body))
        sig = subprocess.check_output(
            ["openssl", "pkeyutl", "-sign", "-rawin", "-inkey", self.key,
             "-in", message], timeout=5).hex()
        envelope = canonical(dict(algorithm="Ed25519", payload=body, signature=sig)) + b"\n"
        response = canonical({"signedEnvelope": envelope.decode()})
        observation = {"signedWalReadbackSha256": digest(response)}
        record = canonical({"observation": observation, "nexusResponse":response.decode()})+b"\n"
        return observation, record

    def test_real_v2_signature_and_exact_historical_scope(self):
        observed, record = self.signed_record()
        self.assertEqual(ev.verify_record(record, observed, self.expected, 1000, 1500), self.payload)
        for changes in ({"runtimeId":"0"*64}, {"hostPid":1235}, {"inventorySequence":1},
                        {"committedChargeHeadsSha256":"0"*64}, {"canResume":True},
                        {"refundableBytes":1}, {"authorizedBytes": False}, {"schemaVersion":1},
                        {"issuedAtMs":999}, {"validUntilMs":9000}):
            with self.subTest(changes=changes):
                observed, record = self.signed_record(dict(self.payload, **changes))
                with self.assertRaises(AssertionError):
                    ev.verify_record(record, observed, self.expected, 1000, 1500)
        observed, record = self.signed_record(domain=b"XMESH_QUOTA_V2_PUBLIC_TLS_WAL_HEAD_V1\0")
        with self.assertRaises(subprocess.CalledProcessError):
            ev.verify_record(record, observed, self.expected, 1000, 1500)

    def test_exact_response_bytes_and_no_ambiguous_json(self):
        observed, record = self.signed_record()
        doc = json.loads(record)
        doc["nexusResponse"] += " "
        with self.assertRaises(AssertionError):
            ev.verify_record(canonical(doc)+b"\n", observed, self.expected, 1000, 1500)
        with self.assertRaises(AssertionError):
            ev.verify_record(record.replace(b'{"nexusResponse"', b'{"nexusResponse":"","nexusResponse"',1),
                             observed,self.expected,1000,1500)
        with self.assertRaises(AssertionError):
            ev.verify_record(record, {"signedWalReadbackSha256":"0"*64},
                             self.expected,1000,1500)

    def ledger_fixture(self):
        main = "xmesh-u100--vless-main"
        caps = {}
        for uid in (100, 101):
            alias = f"xmesh-u{uid}--vless-main"
            cap = dict(algorithm="Ed25519", payload=dict(
                nodeId=9, userId=uid, runtimeId=self.runtime,
                accountEpoch="00000000-0000-0000-0000-000000000001",
                meterEpoch="00000000-0000-0000-0000-000000000002",
                reservationId=f"00000000-0000-0000-0000-{uid:012}",
                reservationRevision=1, aliasScopes=[dict(email=alias,class_="main")]),
                signature="f"*128)
            # Wire uses literal class, not Python's reserved keyword.
            cap["payload"]["aliasScopes"][0]["class"] = cap["payload"]["aliasScopes"][0].pop("class_")
            caps[uid] = canonical(cap)+b"\n"
        streams, indexed = {}, {}
        previous = "0"*64
        for sequence,(direction, amount) in enumerate((("uplink",11),("downlink",13)),1):
            name = "meter-" + digest(f"{self.runtime}\x00{main}\x00{direction}".encode()) + ".jsonl"
            step = dict(schemaVersion=1,runtimeId=self.runtime,email=main,direction=direction,
                        sequence=1,previousBytes=0,nextBytes=amount,previousDigest="0"*64,digest="")
            step["digest"] = digest(wire(step))
            streams[name] = wire(step)
            birth = dict(schemaVersion=1,sequence=sequence,filename=name,runtimeId=self.runtime,
                         email=main,direction=direction,firstWalDigest=step["digest"],
                         previousDigest=previous,digest="")
            birth["digest"] = previous = digest(wire(birth))
            indexed[name] = wire(birth)
        inventory = b"".join(indexed.values())
        ledger = {ev.LOCK:b"",ev.INVENTORY:inventory,**streams}
        denials = {}
        for uid, raw in caps.items():
            cap = json.loads(raw)["payload"]
            ledger[f"positive-cap-u{uid}.json"] = raw
            alias = f"xmesh-u{uid}--vless-main"
            scope = dict(email=alias,nodeId=9,userId=uid,epoch=cap["accountEpoch"],
                         meterEpoch=cap["meterEpoch"],reservationId=cap["reservationId"],revision=1,
                         revocationId=str(uuid.uuid5(uuid.UUID("74df852d-a5a6-47d8-bac9-55f84d9b102a"),
                                                    self.runtime+":"+cap["reservationId"])))
            up,down = (11,13) if uid==100 else (0,0)
            stem = digest(f"xmesh-u{uid}".encode())
            fence = ledger[f"fence-{stem}.json"] = wire(dict(scope,schemaVersion=1))
            checkpoint = ledger[f"observed-{stem}.json"] = wire(dict(
                scope,schemaVersion=3,runtimeId=self.runtime,uplinkBytes=up,downlinkBytes=down,
                inboundMeters=[dict(email=alias,uplinkBytes=up,downlinkBytes=down)],
                drained=True,finalMeterVerified=False,refundableBytes=0))
            names = sorted(streams) if uid==100 else []
            meter = b"".join((name+":"+digest(streams[name])+"\n").encode() for name in names)
            meter += b"|fsynced-meter-inventory-v1|"+b"".join(indexed[name] for name in names)
            denials[str(uid)] = digest(fence+checkpoint+b"|conservative-meter-WAL-v1|"+meter)
        manifest = [{"filename":name,"sha256":digest(raw)} for name,raw in sorted(ledger.items())]
        result = dict(durableUserDenials=denials,retiredLedgerSha256=digest(canonical(manifest)))
        return ledger,caps,streams,inventory,result

    def test_independent_exact_sql_byte_reconstruction_including_unspent_user(self):
        ledger,caps,streams,inventory,result = self.ledger_fixture()
        ev.verify_ledger(ledger,caps,streams,inventory,result,self.node,self.runtime)
        for name in ledger:
            with self.subTest(name=name), self.assertRaises(AssertionError):
                ev.verify_ledger(dict(ledger,**{name:ledger[name]+b"x"}),
                                 caps,streams,inventory,result,self.node,self.runtime)
        with self.assertRaises(AssertionError):
            ev.verify_ledger(dict(ledger,**{"unexpected":b""}),caps,streams,inventory,result,
                             self.node,self.runtime)
        wrong = copy.deepcopy(result)
        wrong["durableUserDenials"].pop("101")
        with self.assertRaises(AssertionError):
            ev.verify_ledger(ledger,caps,streams,inventory,wrong,self.node,self.runtime)


if __name__ == "__main__":
    unittest.main()
