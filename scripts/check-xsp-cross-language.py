#!/usr/bin/env python3
"""PR02 CI-only authenticated-message interoperability: Go->Rust and Rust->Go.
Uses public fixed DEMO seeds. DO NOT apply these credentials to actual XMesh nodes.
"""
import hashlib
import json
import os
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
go_binary = os.environ["XSP_GO_CLI"]
rust_binary = os.environ["XSP_RUST_CLI"]
crypto = json.loads((root / "docs/XSP_V2_CRYPTO_POC.json").read_text())
wire = {
    v["id"]: v["signing_input_hex"]
    for v in json.loads((root / "docs/XSP_V2_VECTORS.json").read_text())["vectors"]
}
assert crypto["schema"] == "xsp2-crypto-poc-1"
assert len(crypto["records"]) == 2


def invoke(binary, packet, valid=True):
    completed = subprocess.run(
        [binary],
        input=json.dumps(packet, separators=(",", ":")).encode(),
        capture_output=True,
        timeout=45,
        check=False,
    )
    if valid:
        assert completed.returncode == 0, (
            binary, completed.returncode, completed.stderr.decode(errors="replace")[:400]
        )
        return json.loads(completed.stdout)
    assert completed.returncode != 0, "hybrid verifier accepted invalid signature"
    return None


def digest(raw):
    return hashlib.sha256(bytes.fromhex(raw)).hexdigest()


count = 0
for record in crypto["records"]:
    message = wire[record["id"]]
    for signer, verifier in [(go_binary, rust_binary), (rust_binary, go_binary)]:
        signed = invoke(signer, {
            "mode": "sign",
            "messageHex": message,
            "edSeedHex": record["ed_seed_hex"],
            "pqSeedHex": record["mldsa_seed_hex"],
        })
        assert signed["mode"] == "signed"
        assert signed["messageHex"] == message
        assert digest(signed["edPublicHex"]) == record["ed_public_sha256"]
        assert digest(signed["pqPublicHex"]) == record["mldsa_public_sha256"]
        assert digest(signed["edSignatureHex"]) == record["ed_signature_sha256"]
        assert len(bytes.fromhex(signed["pqSignatureHex"])) == 3309
        if signer == go_binary:
            assert digest(signed["pqSignatureHex"]) == record["mldsa_signature_sha256"]
        payload = dict(signed, mode="verify")
        verified = invoke(verifier, payload)
        assert verified["mode"] == "verified"
        count += 1
        for field in ("edSignatureHex", "pqSignatureHex"):
            bad = dict(payload)
            bad[field] = ""
            invoke(verifier, bad, valid=False)
            bad = dict(payload)
            text = payload[field]
            bad[field] = ("0" if text[0] != "0" else "1") + text[1:]
            invoke(verifier, bad, valid=False)
        bad = dict(payload, messageHex=payload["messageHex"] + "21")
        invoke(verifier, bad, valid=False)
        bad = dict(payload)
        bad["pqPublicHex"] = crypto["records"][1 if record == crypto["records"][0] else 0][
            "mldsa_seed_hex"
        ]
        invoke(verifier, bad, valid=False)
print(f"XSP-v2 direct Go↔Rust hybrid interoperability: {count} passing signed-message exchanges; tamper and downgrade rejected.")
