#!/usr/bin/env python3
"""Build a THROWAWAY cross-language owner-enrollment PoP test fixture.
Never writes demo private keys to Git, CI artifacts, logs or real Node hosts.
Go keytool creates protected keys under a 0700 temporary directory.
"""
import json
import os
import pathlib
import subprocess
import tempfile

keytool = os.environ["XSP_GO_KEYTOOL"]
runner_temp = pathlib.Path(os.environ["RUNNER_TEMP"])
challenge = "09" * 32

def run(*args):
    out = subprocess.run([keytool, *args], text=True, capture_output=True, check=True, timeout=25)
    return json.loads(out.stdout)

with tempfile.TemporaryDirectory(prefix="xsp-enrollment-ci-") as home:
    root = pathlib.Path(home)
    root.chmod(0o700)
    master = str(root / "wrapping.key")
    vault = str(root / "node.vault.json")
    run("init-master", "-key", master)
    public = run("create", "-key", master, "-vault", vault, "-node", "42", "-purpose", "node_request")
    proof = run("prove", "-key", master, "-vault", vault, "-challenge", challenge)
    assert public["nodeId"] == 42
    assert public["keyEpoch"] == 1
    assert proof["nodeId"] == public["nodeId"]
    assert proof["keyEpoch"] == public["keyEpoch"]
    assert proof["challengeHex"] == challenge
    assert len(proof["mldsa65SignatureB64"]) > 4000
    # Distinct one-use challenge with a ROTATION domain, including old/new
    # epochs. Neither private key nor active vault key material is exported.
    prepared = run("prepare-rotation", "-key", master, "-vault", vault, "-expected-epoch", "1")
    rotated = run("prove-prepared", "-key", master, "-vault", vault,
                  "-expected-epoch", "1", "-challenge", challenge)
    assert prepared["keyEpoch"] == 2
    assert rotated["fromEpoch"] == 1 and rotated["keyEpoch"] == 2
    assert rotated["nodeId"] == 42 and rotated["challengeHex"] == challenge
    rotation_path = runner_temp / "xsp-rotation-proof.json"
    rotation_path.write_text(json.dumps({"public": prepared, "proof": rotated}) + "\n")
    rotation_path.chmod(0o600)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        env.write(f"XSP_V2_ROTATION_PROOF_FIXTURE={rotation_path}\n")
    fixture_path = runner_temp / "xsp-owner-proof.json"
    fixture_path.write_text(json.dumps({"public": public, "proof": proof}) + "\n")
    fixture_path.chmod(0o600)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as env:
        env.write(f"XSP_V2_OWNER_PROOF_FIXTURE={fixture_path}\n")
    print("Go staging key vault initialized and owner enrollment PoP fixture generated without exporting private keys.")
