#!/usr/bin/env python3
"""Reconstruct the pinned newer Matematyka interface for the active-composition acceptance suite."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "oq" / "counting" / "SOURCE.json"


def main() -> int:
    source = json.loads(META.read_text(encoding="utf-8"))
    commit = source["base_commit"]
    with tempfile.TemporaryDirectory(prefix="oq-matematyka-active-") as tmp:
        target = Path(tmp)
        (target / "oq").mkdir()
        # Git is the custody/handoff surface. Never depend on a mutable local path.
        for name in ("oq.js", "oq16.js", "oqopt.js", "oqrank.js", "qasm.js"):
            data = subprocess.check_output(
                ["git", "show", f"{commit}:oq/{name}"], cwd=ROOT
            ).replace(b"\r\n", b"\n")
            expected = source["files"][name]["base_lf_sha256"]
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(f"base source mismatch: {name}")
            (target / "oq" / name).write_bytes(data)
        subprocess.run(["git", "init", "-q", str(target)], check=True)
        patch = (ROOT / "oq/counting/matematyka-qasm.patch").read_bytes()
        subprocess.run(["git", "apply", "--check", "-"], cwd=target, input=patch, check=True)
        subprocess.run(["git", "apply", "-"], cwd=target, input=patch, check=True)
        for name in ("oq.js", "oq16.js", "oqopt.js", "oqrank.js", "qasm.js"):
            data = (target / "oq" / name).read_bytes()
            expected = source["files"][name]["source_lf_sha256"]
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(f"Matematyka source mismatch: {name}")
        env = dict(os.environ, OQ_ENGINE_DIR=str(target / "oq"), OQ_REQUIRE_MATEMATYKA="1")
        print("Pinned Matematyka interface: all five normalized source hashes match", flush=True)
        return subprocess.run(["node", str(ROOT / "oq/test-active.js")], env=env, cwd=ROOT).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        raise SystemExit(1)
