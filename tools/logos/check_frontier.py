"""Compare the current English Logos reading with a local Public Canon release."""

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


DEFAULT_READING = Path(__file__).resolve().parents[2] / "logos" / "logos.md"
CLAIM_ID = r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+"


def reading_frontier(text):
    section = text.split("\n## What is missing\n", 1)[1].split("\n## ", 1)[0]
    entries = []
    for line in section.splitlines():
        if not line.startswith("|") or "[" not in line:
            continue
        cell = line.strip().strip("|").rsplit("|", 1)[-1]
        for group in re.split(r"(?<=\])\s*[,;]\s*", cell):
            match = re.fullmatch(rf"({CLAIM_ID}(?:, {CLAIM_ID})*) \[([HO])\]", group.strip())
            if not match:
                raise ValueError(f"Unrecognized Frontier table entry: {group.strip()}")
            entries.extend((claim, match[2]) for claim in match[1].split(", "))
    return Counter(entries)


def verify(canon_dir, reading):
    status = dict(re.findall(r"^([A-Z_0-9]+):\s+([^\n]+)", (canon_dir / "STATUS.md").read_text("utf-8"), re.M))
    edition = json.loads(Path(__file__).with_name("editions.json").read_text("utf-8"))["current"]["canon"]
    for key, field in (("tag", "TAG"), ("content_commit", "CONTENT_COMMIT"), ("canon_sha256", "CANON_SHA256")):
        if edition[key] != status[field]:
            raise ValueError(f"Edition metadata {key} differs from the activation record")
    if status["STATE"] != "ACTIVE" or f'/blob/{status["TAG"]}/STATUS.md)' not in reading:
        raise ValueError("The reading must cite the active release supplied for this check")
    # A Windows checkout may use CRLF. The activation record fingerprints the LF Git blob.
    canon = (canon_dir / "canon/CANON.md").read_bytes().replace(b"\r\n", b"\n")
    if len(canon) != int(status["CANON_BYTES"]) or hashlib.sha256(canon).hexdigest() != status["CANON_SHA256"]:
        raise ValueError("Canon length or SHA-256 differs from the activation record")

    with (canon_dir / "canon/REGISTRY.tsv").open(encoding="utf-8", newline="") as source:
        registry = list(csv.DictReader(source, delimiter="\t"))
    counts = Counter(row["status"] for row in registry)
    labels = {row["claim_id"]: row["status"] for row in registry}
    for match in re.finditer(rf"\[([TDCHOF]), ({CLAIM_ID}(?:, {CLAIM_ID})*)\]", reading):
        for claim in match[2].split(", "):
            if labels.get(claim) != match[1]:
                raise ValueError(f"Reading labels {claim} [{match[1]}]; current registry gives {labels.get(claim)}")
    expected = Counter((row["claim_id"], row["status"]) for row in registry if row["status"] in {"H", "O"})
    frontier = (canon_dir / "canon/FRONTIER.md").read_text("utf-8")
    for label, actual in [
        ("Canon Frontier", Counter(re.findall(rf"^- ({CLAIM_ID}) \[([HO])\]:", frontier, re.M))),
        ("Logos table", reading_frontier(reading)),
    ]:
        if actual != expected:
            raise ValueError(f"{label} differs from the registry. Missing {list((expected - actual).elements())}, "
                             f"extra {list((actual - expected).elements())}")

    opening = reading.split("\n## How to read this\n", 1)[1].lstrip().split("\n\n", 1)[0]
    for phrase in [f"{len(registry)} claims", f"{sum(expected.values())} live", *[f"{n} {s}" for s, n in counts.items()]]:
        if not re.search(rf"\b{re.escape(phrase)}\b", opening):
            raise ValueError(f"Registry count missing or incorrect in the reading: {phrase}")
    print(f'{status["CANON"]}: Canon fingerprint, {len(registry)} claims and {sum(expected.values())} live table entries match.')


def verify_site(directory):
    metadata = json.loads((directory / "SOURCE.json").read_text("utf-8"))
    edition = metadata["current"]
    pin = json.loads(Path(__file__).with_name("editions.json").read_text("utf-8"))["current"]["canon"]
    if edition["canon"] != pin or (edition["html"], edition["markdown"]) != ("index.html", "logos.md"):
        raise ValueError("Public provenance and current edition disagree")
    expected = {"index.html": edition["html_sha256"], "logos.md": edition["markdown_sha256"]}
    for name, digest in edition["figures"].items():
        if not re.fullmatch(r"fig-[a-zA-Z0-9_-]+\.svg", name):
            raise ValueError(f"Unexpected public figure name {name}")
        expected[name] = digest
    files = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()}
    difference = files ^ (set(expected) | {"SOURCE.json"})
    if difference:
        raise ValueError(f"Public Logos file inventory differs from the current edition: {sorted(difference)}")
    for name, digest in expected.items():
        contents = (directory / name).read_bytes().replace(b"\r\n", b"\n")
        if hashlib.sha256(contents).hexdigest() != digest:
            raise ValueError(f"Public file {name} differs from its recorded fingerprint")
    print("One public HTML reading and one Markdown counterpart; all output fingerprints match.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("canon_directory", type=Path, help="Release root containing STATUS.md and canon/")
    parser.add_argument("--markdown", type=Path, default=DEFAULT_READING)
    parser.add_argument("--check-site", action="store_true", help="Check the built public Logos file set and provenance")
    args = parser.parse_args()
    try:
        verify(args.canon_directory, args.markdown.read_text("utf-8"))
        if args.check_site:
            verify_site(DEFAULT_READING.parent)
    except (IndexError, KeyError, OSError, ValueError) as error:
        parser.exit(1, f"Frontier verification failed: {error}\n")
