#!/usr/bin/env python3
"""PR02 demo-only deterministic OpenSSL ML-DSA interop check.
Fixed demo seeds are public: NEVER use for actual Node/Panel private keys.
"""
import hashlib
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
crypto = json.loads((ROOT / "docs/XSP_V2_CRYPTO_POC.json").read_text())
wire = {
    v["id"]: bytes.fromhex(v["signing_input_hex"])
    for v in json.loads((ROOT / "docs/XSP_V2_VECTORS.json").read_text())["vectors"]
}
assert crypto["schema"] == "xsp2-crypto-poc-1"
assert crypto["context"] == ""
assert len(crypto["records"]) == 2
for record in crypto["records"]:
    payload = wire[record["id"]]
    with tempfile.TemporaryDirectory(prefix="xsp-demo-") as name:
        directory = pathlib.Path(name)
        (directory / "message").write_bytes(payload)
        subprocess.run([
            "openssl", "genpkey", "-algorithm", "ML-DSA-65", "-pkeyopt",
            "hexseed:" + record["mldsa_seed_hex"], "-out", str(directory / "key.pem"),
        ], check=True, capture_output=True)
        subprocess.run([
            "openssl", "pkey", "-in", str(directory / "key.pem"),
            "-pubout", "-outform", "DER", "-out", str(directory / "public.der"),
        ], check=True, capture_output=True)
        subprocess.run([
            "openssl", "pkeyutl", "-sign", "-inkey", str(directory / "key.pem"),
            "-in", str(directory / "message"), "-out", str(directory / "signature"),
            "-pkeyopt", "deterministic:1",
        ], check=True, capture_output=True)
        subprocess.run([
            "openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(directory / "key.pem"),
            "-in", str(directory / "message"), "-sigfile", str(directory / "signature"),
        ], check=True, capture_output=True)
        public = (directory / "public.der").read_bytes()[-1952:]
        signature = (directory / "signature").read_bytes()
        assert len(public) == 1952
        assert len(signature) == 3309
        assert hashlib.sha256(public).hexdigest() == record["mldsa_public_sha256"]
        assert hashlib.sha256(signature).hexdigest() == record["mldsa_signature_sha256"]
        (directory / "tampered").write_bytes(payload + b"!")
        rejected = subprocess.run([
            "openssl", "pkeyutl", "-verify", "-pubin", "-inkey", str(directory / "key.pem"),
            "-in", str(directory / "tampered"), "-sigfile", str(directory / "signature"),
        ], capture_output=True)
        assert rejected.returncode != 0, "tampered payload accepted"
print("OpenSSL signatures match deterministic Go 1.27.3 vectors in both directions.")
