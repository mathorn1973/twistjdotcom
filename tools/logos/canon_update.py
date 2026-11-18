"""Detect an authoritative Canon update and emit its editorial evidence as JSON."""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile


SITE = Path(__file__).resolve().parents[2]
UPSTREAM = "https://github.com/mathorn1973/twist-j"
TAG = r"canon-v([1-9][0-9]*)"
SHA = r"[0-9a-f]{40}"
DIGEST = r"[0-9a-f]{64}"
FIELDS = ("STATE", "CANON", "AUTHORITY", "TAG", "CONTENT_COMMIT", "CANON_SHA256", "CANON_BYTES")
FILES = ("STATUS.md", "canon/CANON.md", "canon/CORE.md", "canon/FRONTIER.md",
         "canon/REGISTRY.tsv", "canon/CHANGELOG.md")
PIN_FIELDS = ("tag", "activation_commit", "tag_object", "content_commit", "canon_sha256", "canon_bytes")


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=False)
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise ValueError(f"git {args[0]} failed: {detail[-1] if detail else result.returncode}")
    return result.stdout


def text(repo, *args):
    return git(repo, *args).decode("utf-8").strip()


def status(repo, commit):
    markdown = git(repo, "show", f"{commit}:STATUS.md").decode("utf-8")
    blocks = re.findall(r"^```text\s*\n(.*?)^```\s*$", markdown, re.M | re.S)
    if not blocks:
        raise ValueError("STATUS.md is missing its activation block")
    fields = {}
    for key, value in re.findall(r"^([A-Z][A-Z_0-9]*):[ \t]*(.+)$", blocks[0], re.M):
        if key in fields:
            raise ValueError(f"Duplicate activation field {key}")
        fields[key] = value.strip()
    if any(field not in fields for field in FIELDS):
        raise ValueError("Incomplete Canon activation declaration")
    tag = re.fullmatch(TAG, fields["TAG"])
    if (not tag or fields["STATE"] != "ACTIVE"
            or fields["CANON"] != f"Public Canon v{tag[1]}"
            or fields["AUTHORITY"] != "mathorn1973/twist-j main"
            or not re.fullmatch(SHA, fields["CONTENT_COMMIT"])
            or not re.fullmatch(DIGEST, fields["CANON_SHA256"])
            or not re.fullmatch(r"[1-9][0-9]*", fields["CANON_BYTES"])):
        raise ValueError("Invalid active Canon declaration")
    return fields


def verify_release(repo, tag, main, expected=None):
    ref = f"refs/tags/{tag}"
    if text(repo, "cat-file", "-t", ref) != "tag":
        raise ValueError(f"{tag} is missing its annotated activation tag")
    tag_oid = text(repo, "rev-parse", "--verify", ref)
    commit = text(repo, "rev-parse", "--verify", f"{tag_oid}^{{commit}}")
    git(repo, "merge-base", "--is-ancestor", commit, main)
    fields = status(repo, commit)
    if fields["TAG"] != tag or (expected and fields != expected):
        raise ValueError(f"{tag} activation differs from the authoritative declaration")
    content = fields["CONTENT_COMMIT"]
    git(repo, "merge-base", "--is-ancestor", content, commit)
    release = {"tag": tag, "activation_commit": commit, "tag_object": tag_oid,
               "content_commit": content, "canon_sha256": fields["CANON_SHA256"],
               "canon_bytes": int(fields["CANON_BYTES"])}
    path = "canon/CANON.md"
    canon = git(repo, "show", f"{commit}:{path}")
    if (len(canon) != release["canon_bytes"]
            or hashlib.sha256(canon).hexdigest() != release["canon_sha256"]
            or canon != git(repo, "show", f"{content}:{path}")):
        raise ValueError(f"{tag} Canon bytes, SHA-256 or content commit disagree")
    return release


def registry(repo, commit):
    content = git(repo, "show", f"{commit}:canon/REGISTRY.tsv").decode("utf-8")
    reader = csv.DictReader(io.StringIO(content), delimiter="\t")
    required = {"claim_id", "status", "scope", "canon_section", "evidence", "falsifier"}
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not required.issubset(reader.fieldnames):
        raise ValueError("Unexpected Canon registry schema")
    rows = {}
    for row in reader:
        claim = row.get("claim_id")
        if not claim or claim in rows or None in row or any(value is None for value in row.values()):
            raise ValueError(f"Invalid or duplicate Canon registry row: {claim}")
        rows[claim] = row
    return rows


def snapshot(repo, commit, destination):
    target = destination.resolve()
    if target.is_relative_to(SITE):
        raise ValueError("stage directory must be outside the website tree")
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        raise ValueError("stage directory must be empty")
    sources = {path: git(repo, "show", f"{commit}:{path}") for path in FILES}
    for path, data in sources.items():
        output = target / path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)


def detect(repo, main, pin, from_tag, stage):
    old_tag = from_tag or pin["tag"]
    old_version = re.fullmatch(TAG, old_tag)
    if not old_version:
        raise ValueError("Expected the previous tag in canon-vNN form")
    main = text(repo, "rev-parse", "--verify", f"{main}^{{commit}}")
    latest = status(repo, main)
    new_tag = latest["TAG"]
    new_version = int(re.fullmatch(TAG, new_tag)[1])
    if new_version < int(old_version[1]):
        raise ValueError(f"Refusing Canon downgrade from {old_tag} to {new_tag}")
    new = verify_release(repo, new_tag, main, latest)
    old = new if old_tag == new_tag else verify_release(repo, old_tag, main)
    if old_tag == pin["tag"]:
        for key in ("content_commit", "canon_sha256", "activation_commit", "tag_object", "canon_bytes"):
            if key in pin and old[key] != pin[key]:
                raise ValueError(f"Published {old_tag} pin differs from the official {key}")
    changes = []
    if old_tag != new_tag:
        git(repo, "merge-base", "--is-ancestor", old["activation_commit"], new["activation_commit"])
        before = registry(repo, old["activation_commit"])
        after = registry(repo, new["activation_commit"])
        for claim in sorted(before.keys() | after.keys()):
            a, b = before.get(claim), after.get(claim)
            if a == b:
                continue
            kind = "added" if a is None else "removed" if b is None else "modified"
            fields = sorted(key for key in a.keys() | b.keys() if a.get(key) != b.get(key)) if a and b else []
            changes.append({"claim_id": claim, "kind": kind, "old_status": a["status"] if a else None,
                            "new_status": b["status"] if b else None, "changed_fields": fields,
                            "old": a, "new": b})
    if stage:
        snapshot(repo, new["activation_commit"], stage)
    return {"changed": old_tag != new_tag, "main_commit": main, "previous": old, "current": new,
            "registry_changes": changes}


def known_head(pin):
    if not all(field in pin for field in PIN_FIELDS):
        return None
    if (not re.fullmatch(TAG, pin["tag"])
            or any(not re.fullmatch(SHA, pin[key]) for key in ("activation_commit", "tag_object", "content_commit"))
            or not re.fullmatch(DIGEST, pin["canon_sha256"])
            or type(pin["canon_bytes"]) is not int or pin["canon_bytes"] <= 0):
        raise ValueError("Malformed immutable site pin")
    ref = f"refs/tags/{pin['tag']}"
    advertised = dict(line.split("\t", 1)[::-1] for line in
                      text(SITE, "ls-remote", UPSTREAM + ".git", "refs/heads/main", ref, ref + "^{}").splitlines())
    if (advertised.get(ref) != pin["tag_object"]
            or advertised.get(ref + "^{}") != pin["activation_commit"]):
        raise ValueError(f"Official {pin['tag']} tag was removed or reissued")
    if advertised.get("refs/heads/main") != pin["activation_commit"]:
        return None
    release = {field: pin[field] for field in PIN_FIELDS}
    return {"changed": False, "main_commit": pin["activation_commit"],
            "previous": release, "current": release, "registry_changes": []}


def fetch_and_detect(work, pin, from_tag, stage):
    url = UPSTREAM + ".git"
    if not (work / ".git").is_dir():
        if any(work.iterdir()):
            raise ValueError("Git cache must be an empty directory or a Canon detector cache")
        git(work, "init", "--quiet")
        git(work, "remote", "add", "origin", url)
        git(work, "config", "remote.origin.promisor", "true")
        git(work, "config", "remote.origin.partialclonefilter", "blob:none")
    if text(work, "remote", "get-url", "origin") != url:
        raise ValueError("Git cache origin is not the authoritative Canon repository")
    main_ref = "refs/remotes/origin/main"
    git(work, "fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin",
        f"refs/heads/main:{main_ref}")
    main = text(work, "rev-parse", "--verify", f"{main_ref}^{{commit}}")
    tags = {status(work, main)["TAG"], from_tag or pin["tag"]}
    if not all(re.fullmatch(TAG, tag) for tag in tags):
        raise ValueError("Expected the previous tag in canon-vNN form")
    git(work, "fetch", "--quiet", "--no-tags", "--filter=blob:none", "origin",
        *(f"refs/tags/{tag}:refs/tags/{tag}" for tag in sorted(tags)))
    return detect(work, main, pin, from_tag, stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--canon-repo", type=Path, help="Use local Git objects without fetching.")
    parser.add_argument("--main-ref", default="refs/heads/main", help="Local main ref or replay commit.")
    parser.add_argument("--from-tag", help="Compare using a different published baseline.")
    parser.add_argument("--cache-dir", type=Path, help="Reuse an external Git cache for online verification.")
    parser.add_argument("--stage-dir", type=Path, help="Write verified normative files to an empty external directory.")
    args = parser.parse_args()
    try:
        pin = json.loads(Path(__file__).with_name("editions.json").read_text("utf-8"))["current"]["canon"]
        if args.canon_repo:
            result = detect(args.canon_repo, args.main_ref, pin, args.from_tag, args.stage_dir)
        else:
            result = known_head(pin) if not args.from_tag and not args.stage_dir else None
            if result is None:
                if args.cache_dir:
                    cache = args.cache_dir.resolve()
                    if cache.is_relative_to(SITE):
                        raise ValueError("Git cache must be outside the website tree")
                    cache.mkdir(parents=True, exist_ok=True)
                    result = fetch_and_detect(cache, pin, args.from_tag, args.stage_dir)
                else:
                    with tempfile.TemporaryDirectory(prefix="logos-canon-") as work:
                        result = fetch_and_detect(Path(work), pin, args.from_tag, args.stage_dir)
    except (ValueError, OSError, KeyError) as exc:
        parser.exit(1, f"Canon update check failed: {exc}\n")
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
