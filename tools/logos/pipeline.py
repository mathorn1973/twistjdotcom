#!/usr/bin/env python3
"""Logos pipeline: public English editorial edition and private Czech translation workflow.

The Czech original is never committed. Only its block hashes, the English blocks and the English
figures live in this repository. See RUNBOOK.md for the sync procedure.

Subcommands (run from anywhere; paths are resolved against the repository root):

  normalize EXPORT.md OUT.md        fix Claude Docs export quirks, write the normalized Czech source
  plan SOURCE.md PENDING.json       list text blocks that have no English yet (and figure captions)
  fill PENDING.json ENGLISH.md [--source SOURCE.md]
                                    put English blocks written in ENGLISH.md into PENDING.json, in order;
                                    with --source, ENGLISH.md is a whole-document draft aligned block by
                                    block with SOURCE.md (verbatim blocks must be identical)
  apply PENDING.json                merge filled English blocks into memory.json (checked first)
  figure --caption-sha S --en-caption TEXT --file NAME --jsx JSXFILE
                                    register the English figure NAME (already written to logos/) for
                                    the figure whose Czech caption hashes to S
  build-edition
                                    render both public editions; logos/logos.md is never written
  build SOURCE.md --rev REV [--out DIR] [--figs DIR]
                                    merge a translation into the public edition, or build an isolated draft
  check SOURCE.md [--markdown FILE] [--figs DIR]
                                    verify the translation against its Czech source
  jsx2svg JSXFILE OUT.svg           convert a figure's JSX code (as read from the source document) into
                                    a static SVG with the fixed colours; translate its labels afterwards
  build-cs SOURCE.md --rev REV --figs DIR --out DIR
                                    render the Czech source itself as one static page OUT/index.html,
                                    with the Czech figures DIR/<file>.svg inlined (the file names are
                                    those of memory.json). Nothing of this is committed: the page is
                                    republished to the owner's private static copy, see RUNBOOK step 10

Exact text, no network, Python standard library plus the markdown package for the HTML step.
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "logos"
OUT = ROOT / "logos"
MEMORY = TOOLS / "memory.json"
TEMPLATE = TOOLS / "template.html"
EDITION_CONFIG = TOOLS / "editions.json"
TRANSLATION_FIELDS = ("doc_rev", "source_sha256", "blocks", "synced", "memory_blocks", "figures")

CZECH = re.compile(r"[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]")
CANON_ID = re.compile(r"\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b")  # RELATIVE-CONTACT-INTEGRAL-LAW, CMB-S4
STATUS = re.compile(r"\[(candidate-T|candidate-C|T|D|C|H|O|F)(?=[\],;: ])")
NUMBER = re.compile(r"\d+(?:[   ]\d{3})+|\d+")
SCRIPTS = re.compile(r"[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ₀₁₂₃₄₅₆₇₈₉]")
FIGURE = re.compile(r"^\[embedded content: (.+)\]$")
BYLINE = re.compile(r"^[A-Z][a-z]{2} \d{1,2}, \d{4} · @")


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def today() -> str:
    return dt.date.today().isoformat()


# ---------------------------------------------------------------- normalization and blocks

def normalize(text: str) -> str:
    """Undo the Claude Docs markdown export quirks."""
    text = text.replace("\r\n", "\n")
    text = text.replace("&#91;", "[").replace("\\]", "]").replace("\\[", "[").replace("\\_", "_")
    text = re.sub(r"```latex\n(.*?)\n```", lambda m: "$$\n%s\n$$" % m.group(1), text, flags=re.S)
    text = "\n".join(line.rstrip() for line in text.split("\n")).strip() + "\n"
    return text


def split_blocks(text: str):
    """Blocks separated by blank lines; fenced ``` and $$ blocks are kept whole."""
    blocks, cur, fence = [], [], None
    for line in text.split("\n"):
        stripped = line.strip()
        if fence is None and (stripped.startswith("```") or stripped == "$$"):
            if cur:
                blocks.append("\n".join(cur)); cur = []
            fence = "```" if stripped.startswith("```") else "$$"
            cur.append(line)
            continue
        if fence is not None:
            cur.append(line)
            if (fence == "```" and stripped.startswith("```")) or (fence == "$$" and stripped == "$$"):
                blocks.append("\n".join(cur)); cur = []; fence = None
            continue
        if stripped == "":
            if cur:
                blocks.append("\n".join(cur)); cur = []
            continue
        cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    out = []
    for b in blocks:
        if b.startswith("$$") or b.startswith("```"):
            kind = "verbatim"
        elif FIGURE.match(b):
            kind = "figure"
        elif BYLINE.match(b):
            kind = "byline"
        elif b.startswith("# "):
            kind = "title"
        else:
            kind = "text"
        out.append({"kind": kind, "cs": b, "sha": sha(b)})
    return out


# ---------------------------------------------------------------- memory

def load_memory():
    if MEMORY.exists():
        return json.loads(MEMORY.read_text(encoding="utf-8"))
    return {"blocks": {}, "figures": {}}


def save_memory(mem):
    MEMORY.write_text(json.dumps(mem, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- block checks

def block_problems(cs: str, en: str):
    """What an English block must preserve from its Czech block. Returns a list of problems."""
    p = []
    if not en.strip():
        return ["empty"]
    if CZECH.search(en):
        p.append("czech diacritics left: %s" % "".join(sorted(set(CZECH.findall(en)))))
    for name, rx in (("canon ids", CANON_ID), ("status labels", STATUS), ("super/subscripts", SCRIPTS)):
        a, b = Counter(rx.findall(cs)), Counter(rx.findall(en))
        if a != b:
            p.append("%s differ: cs %s / en %s" % (name, sorted((a - b).elements()), sorted((b - a).elements())))
    norm = lambda s: Counter(n.replace(" ", "").replace(" ", "").replace(" ", "") for n in NUMBER.findall(s))
    a, b = norm(cs), norm(en)
    if a != b:
        p.append("numbers differ: cs %s / en %s" % (sorted((a - b).elements()), sorted((b - a).elements())))
    if cs.startswith("|") != en.startswith("|"):
        p.append("table shape differs")
    if cs.startswith("|") and cs.count("\n") != en.count("\n"):
        p.append("table row count differs")
    if cs.startswith("#") and (cs.split(" ")[0] != en.split(" ")[0]):
        p.append("heading level differs")
    if cs.lstrip().startswith(("- ", "1. ")) and cs.count("\n") != en.count("\n"):
        p.append("list item count differs")
    return p


# ---------------------------------------------------------------- commands

def cmd_normalize(a):
    src = Path(a.export).read_text(encoding="utf-8")
    Path(a.out).write_text(normalize(src), encoding="utf-8")
    print("normalized -> %s (%d bytes)" % (a.out, len(normalize(src).encode("utf-8"))))


def cmd_plan(a):
    blocks = split_blocks(Path(a.source).read_text(encoding="utf-8"))
    mem = load_memory()
    pending, figs = [], []
    for i, b in enumerate(blocks):
        if b["kind"] in ("text", "title") and b["sha"] not in mem["blocks"]:
            before = after = ""
            if i > 0 and blocks[i - 1]["kind"] in ("text", "title"):
                before = mem["blocks"].get(blocks[i - 1]["sha"], {}).get("en", "")
            if i + 1 < len(blocks) and blocks[i + 1]["kind"] in ("text", "title"):
                after = mem["blocks"].get(blocks[i + 1]["sha"], {}).get("en", "")
            pending.append({"index": i, "sha": b["sha"], "cs": b["cs"], "en": "",
                            "context_before_en": before, "context_after_en": after})
        if b["kind"] == "figure":
            cap = FIGURE.match(b["cs"]).group(1)
            figs.append({"index": i, "caption_cs": cap, "caption_sha": sha(cap),
                         "known": mem["figures"].get(sha(cap))})
    Path(a.pending).write_text(json.dumps(pending, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    kinds = Counter(b["kind"] for b in blocks)
    print("blocks: %d (%s)" % (len(blocks), ", ".join("%s %d" % kv for kv in sorted(kinds.items()))))
    print("text blocks without English: %d -> %s" % (len(pending), a.pending))
    for f in figs:
        print("figure %d: %s | caption_sha %s | %s" % (
            f["index"], f["caption_cs"], f["caption_sha"][:12], "known, file %s, jsx_sha %s" % (
                f["known"]["file"], f["known"]["jsx_sha"][:12]) if f["known"] else "UNKNOWN, needs English SVG"))
    return 0


def cmd_fill(a):
    pending = json.loads(Path(a.pending).read_text(encoding="utf-8"))
    en_blocks = split_blocks(Path(a.english).read_text(encoding="utf-8"))
    if a.source:
        cs_blocks = split_blocks(Path(a.source).read_text(encoding="utf-8"))
        cs_blocks = [b for b in cs_blocks if b["kind"] != "byline"]
        en_blocks = [b for b in en_blocks if b["kind"] != "byline"]
        if len(cs_blocks) != len(en_blocks):
            print("whole-document draft has %d blocks, source has %d" % (len(en_blocks), len(cs_blocks)))
            for i, (c, e) in enumerate(zip(cs_blocks, en_blocks)):
                if c["kind"] != e["kind"] or (c["kind"] == "verbatim" and c["cs"] != e["cs"]):
                    print("first divergence at block %d: cs %s %r / en %s %r" % (
                        i, c["kind"], c["cs"][:40], e["kind"], e["cs"][:40])); break
            return 1
        by_sha = {}
        for c, e in zip(cs_blocks, en_blocks):
            if c["kind"] == "verbatim" and c["cs"] != e["cs"]:
                print("verbatim block differs:\n%s\n---\n%s" % (c["cs"], e["cs"])); return 1
            if c["kind"] in ("text", "title"):
                by_sha[c["sha"]] = e["cs"]
        for item in pending:
            item["en"] = by_sha.get(item["sha"], "")
    else:
        if len(en_blocks) != len(pending):
            print("ENGLISH.md has %d blocks, pending has %d" % (len(en_blocks), len(pending))); return 1
        for item, e in zip(pending, en_blocks):
            item["en"] = e["cs"]
    Path(a.pending).write_text(json.dumps(pending, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("filled %d of %d pending blocks" % (sum(1 for i in pending if i["en"]), len(pending)))
    return 0


def cmd_apply(a):
    pending = json.loads(Path(a.pending).read_text(encoding="utf-8"))
    mem = load_memory()
    bad = 0
    for item in pending:
        en = item.get("en", "").strip()
        if not en:
            print("block %d: no English given, skipped" % item["index"]); bad += 1; continue
        probs = block_problems(item["cs"], en)
        if probs:
            bad += 1
            print("block %d REJECTED:" % item["index"])
            for p in probs:
                print("   " + p)
            continue
        mem["blocks"][item["sha"]] = {"en": en, "added": today()}
    save_memory(mem)
    print("memory: %d blocks, %d figures; rejected %d" % (len(mem["blocks"]), len(mem["figures"]), bad))
    return 1 if bad else 0


def cmd_figure(a):
    mem = load_memory()
    jsx = Path(a.jsx).read_text(encoding="utf-8")
    svg_path = Path(a.figs) / a.file
    if not svg_path.exists():
        print("%s does not exist; write the English SVG first" % svg_path); return 1
    svg = svg_path.read_text(encoding="utf-8")
    if CZECH.search(svg):
        print("logos/%s still contains Czech diacritics" % a.file); return 1
    mem["figures"][a.caption_sha] = {"en_caption": a.en_caption, "file": a.file,
                                     "jsx_sha": sha(jsx), "added": today()}
    save_memory(mem)
    print("figure registered: %s -> %s" % (a.caption_sha[:12], a.file))
    return 0


# The translation of this exact reference block is a snapshot of Canon v109.
# Keep the links in memory unchanged so source and translation checks still see
# the same block and number tokens.
V109_REFERENCES_SHA = "92bc88cb96180d9968a1eb122553223addf9f99c2df18bae6762f71c2f7bcff6"
V109_REFERENCES = (
    ("blob", "STATUS.md"),
    ("blob", "canon/REGISTRY.tsv"),
    ("blob", "canon/FRONTIER.md"),
    ("tree", "notes/C-J-INTEGRAL-RELATIVE-CONTACT-N"),
    ("tree", "probes/P-RELATIVE-CONTACT-FOUR-SLOT-MINIMUM-1"),
)


def pin_v109_references(text):
    for kind, path in V109_REFERENCES:
        base = f"https://github.com/mathorn1973/twist-j/{kind}"
        text = text.replace(f"]({base}/main/{path})", f"]({base}/canon-v109/{path})")
    return text


def english_blocks(blocks, mem):
    """The English document as a list of (kind, text, meta). Raises on a missing translation."""
    out = []
    for b in blocks:
        if b["kind"] == "byline":
            continue
        if b["kind"] == "verbatim":
            out.append(("verbatim", b["cs"], None))
        elif b["kind"] == "figure":
            cap = FIGURE.match(b["cs"]).group(1)
            fig = mem["figures"].get(sha(cap))
            if not fig:
                raise SystemExit("figure without English: %s" % cap)
            out.append(("figure", "![%s](%s)" % (fig["en_caption"], fig["file"]), fig))
        else:
            en = mem["blocks"].get(b["sha"])
            if not en:
                raise SystemExit("block %s without English: %s" % (b["sha"][:12], b["cs"][:60]))
            text = en["en"]
            if b["sha"] == V109_REFERENCES_SHA:
                text = pin_v109_references(text)
            out.append((b["kind"], text, None))
    return out


TRANSLATION_NOTE = ("Working document of the TWIST-J program, NON-CANONICAL. Translated from the Czech working "
                    "original, which is not published; the translation is machine-made and synced automatically "
                    "from the source document. Nothing here is stronger than the registry row it rests on.")


def translated_markdown(blocks, mem):
    en = english_blocks(blocks, mem)
    title = next((t for k, t, _ in en if k == "title"), "")
    if not title:
        raise SystemExit("translation has no title")
    body = "\n\n".join(t for k, t, _ in en if k != "title") + "\n"
    return f"{title}\n\n{TRANSLATION_NOTE}\n\n{body}"


def manuscript(markdown_text):
    first, separator, rest = markdown_text.partition("\n")
    if not separator or not first.startswith("# ") or not first[2:].strip():
        raise SystemExit("the first line must be a Markdown H1")
    return first[2:].strip(), rest.lstrip("\n")


def referenced_figures(body, directory, fallbacks=None):
    figures = {}
    for caption, name in re.findall(r"^!\[([^\]\n]+)\]\((fig-[A-Za-z0-9-]+\.svg)\)$", body, re.M):
        if name in figures:
            raise SystemExit(f"figure appears twice: {name}")
        svg = fallbacks[name] if fallbacks and name in fallbacks else None
        if svg is None:
            svg = (directory / name).read_text(encoding="utf-8")
        figures[name] = {"file": name, "caption": caption, "svg": svg}
    return list(figures.values())


def write_atomic(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix="." + path.name + ".",
                                     delete=False) as temporary:
        staging = Path(temporary.name)
    try:
        staging.write_bytes(data)
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)


def write_outputs(directory, files):
    directory.mkdir(parents=True, exist_ok=True)
    for name, contents in files.items():
        path = directory / name
        data = contents.encode("utf-8")
        if not path.exists() or path.read_bytes() != data:
            write_atomic(path, data)
        print("%-14s %7d bytes  sha256 %s" % (name, len(data), sha(contents)))


def cmd_build(a):
    if not a.out:
        return sync_translation(a)
    draft = Path(a.out).resolve()
    if draft == ROOT or ROOT in draft.parents:
        raise SystemExit("translation draft output must be outside the public repository")
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    md = translated_markdown(blocks, load_memory())
    title, body = manuscript(md)
    body = body.removeprefix(TRANSLATION_NOTE + "\n\n")
    figures = referenced_figures(body, Path(a.figs))
    draft_edition = {"kind": "draft", "date": today(), "label": "Local translation draft",
                     "description": "A translation draft for editorial review."}
    note = f"English translation of private Czech source revision {a.rev}. Local draft for editorial review."
    page = render_html(title, note, body, figures, rev=a.rev, edition=draft_edition)
    write_outputs(draft, {"logos.md": md, "index.html": page,
                          "SOURCE.json": json.dumps({"kind": "translation-draft", "doc_rev": a.rev,
                                                     "source_sha256": sha(source), "blocks": len(blocks),
                                                     "markdown_sha256": sha(md)}, indent=2) + "\n",
                          **{f["file"]: f["svg"] for f in figures}})
    return 0


def load_config():
    return json.loads(EDITION_CONFIG.read_text(encoding="utf-8"))


def revision_124_markdown(base, previous_source):
    if previous_source:
        source = Path(previous_source).read_text(encoding="utf-8")
        if sha(source) != base["source_sha256"]:
            raise SystemExit("previous source hash does not match normalized Czech revision 124")
        blocks = split_blocks(source)
        if len(blocks) != base["blocks"] or sum(b["sha"] == V109_REFERENCES_SHA for b in blocks) != 1:
            raise SystemExit("previous source block inventory is inconsistent")
        return translated_markdown(blocks, load_memory())
    result = subprocess.run(["git", "cat-file", "blob", base["git_blob"]], cwd=ROOT,
                            capture_output=True, check=False)
    if result.returncode:
        raise SystemExit("revision 124 merge base unavailable. Fetch its Git history or pass "
                         "--previous-source with the verified normalized Czech revision 124.")
    return result.stdout.decode("utf-8")


def edition_files(config, current_md, translation, candidate_figures=None):
    current = config["current"]
    current_title, current_body = manuscript(current_md)
    current_figures = referenced_figures(current_body, OUT, candidate_figures)
    current_version = current["canon"]["tag"].removeprefix("canon-")
    edition = {**current, "kind": "editorial", "label": "English editorial reading",
               "url": "https://twistj.com/logos/",
               "description": f"Non-canonical English editorial reading of the TWIST-J programme based on Public Canon {current_version}.",
               "markdown": "logos.md"}
    current_html = render_html(current_title, "", current_body, current_figures, edition=edition)
    provenance = {
        **translation,
        "schema": 1,
        "hash_encoding": "UTF-8 with LF line endings",
        "current": {
            "kind": "english-editorial-reading",
            "initial_translation_revision": config["initial_translation"]["doc_rev"],
            "date": current["date"], "canon": current["canon"],
            "markdown": "logos.md", "markdown_sha256": sha(current_md),
            "html": "index.html", "html_sha256": sha(current_html),
            "figures": {f["file"]: sha(f["svg"]) for f in current_figures},
        },
    }
    return {"index.html": current_html, "SOURCE.json": json.dumps(provenance, indent=2) + "\n"}


def load_translation(base):
    provenance = OUT / "SOURCE.json"
    stored = json.loads(provenance.read_text(encoding="utf-8")) if provenance.exists() else {}
    defaults = {"doc_rev": base["doc_rev"], "source_sha256": base["source_sha256"],
                "blocks": base["blocks"], "synced": base["date"],
                "memory_blocks": len(load_memory()["blocks"]), "figures": len(base["figures"])}
    translation = {k: stored.get(k, defaults[k]) for k in TRANSLATION_FIELDS}
    initial = translation["doc_rev"] == base["doc_rev"]
    return {**translation,
            "translation_sha256": base["markdown_sha256"] if initial else stored["translation_sha256"],
            "translation_figures": base["figures"] if initial else stored["translation_figures"]}


def translation_cache_file(digest):
    override = os.environ.get("LOGOS_TRANSLATION_CACHE")
    if override:
        cache = Path(override).expanduser()
    else:
        user_cache = os.environ.get("LOCALAPPDATA") if os.name == "nt" else os.environ.get("XDG_CACHE_HOME")
        cache = (Path(user_cache) if user_cache else Path.home() / ".cache") / "twistj" / "logos"
    cache = cache.resolve()
    if cache == ROOT or ROOT in cache.parents or any(
        (directory / ".git").exists() for directory in (cache, *cache.parents)
    ):
        raise SystemExit("the Logos translation cache must be outside Git checkouts")
    if not re.fullmatch("[0-9a-f]{64}", digest):
        raise SystemExit("invalid Logos translation baseline SHA-256")
    return cache / (digest + ".md")


def store_translation(markdown):
    path = translation_cache_file(sha(markdown))
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        if sha(path.read_text(encoding="utf-8")) != sha(markdown):
            raise SystemExit("private translation cache has a mismatched baseline checksum")
    else:
        write_atomic(path, markdown.encode("utf-8"))


def translation_baseline(base, translation, previous_source):
    revision = translation["doc_rev"]
    digest = translation["translation_sha256"]
    if revision == base["doc_rev"]:
        markdown = revision_124_markdown(base, previous_source)
    elif previous_source:
        source = Path(previous_source).read_text(encoding="utf-8")
        if sha(source) != translation["source_sha256"]:
            raise SystemExit(f"previous source hash does not match normalized Czech revision {revision}")
        blocks = split_blocks(source)
        if len(blocks) != translation["blocks"]:
            raise SystemExit("previous source block inventory is inconsistent")
        markdown = translated_markdown(blocks, load_memory())
    else:
        cache_file = translation_cache_file(digest)
        try:
            markdown = cache_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise SystemExit(f"private translation baseline unavailable for revision {revision}. "
                             "Restore the cached baseline or pass --previous-source with the "
                             "verified normalized Czech source of that revision.") from None
    if sha(markdown) != digest:
        raise SystemExit("last English translation baseline checksum does not match SOURCE.json")
    return markdown


def merge_translation(editorial, baseline, translation):
    if baseline == translation:
        return editorial
    with tempfile.TemporaryDirectory(prefix="logos-translation-") as work:
        inputs = [Path(work) / name for name in ("editorial.md", "baseline.md", "translation.md")]
        for path, contents in zip(inputs, (editorial, baseline, translation)):
            path.write_text(contents, encoding="utf-8", newline="\n")
        result = subprocess.run(["git", "merge-file", "-p", "-L", "current English editorial reading",
                                 "-L", "previous English translation", "-L", "new English translation",
                                 *map(str, inputs)], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                check=False)
    merged = result.stdout.decode("utf-8")
    if result.returncode:
        headings = []
        section = "opening"
        for n, line in enumerate(merged.splitlines(), 1):
            if line.startswith(("## ", "### ")):
                section = line.lstrip("# ").strip()
            elif line == "<<<<<<< current English editorial reading":
                headings.append(f"{section} (merge line {n})")
        if headings:
            raise SystemExit("Logos translation conflicts in " + "; ".join(headings) +
                             ". Resolve overlapping edits before retrying. Public outputs were unchanged.")
        raise SystemExit("could not merge Logos translation: " + result.stderr.decode("utf-8", errors="replace"))
    return merged


def cmd_build_edition(a):
    config = load_config()
    translation = load_translation(config["initial_translation"])
    current_md = (OUT / "logos.md").read_text(encoding="utf-8")
    write_outputs(OUT, edition_files(config, current_md, translation))
    return 0


def sync_translation(a):
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    mem = load_memory()
    md = translated_markdown(blocks, mem)
    config = load_config()
    base = config["initial_translation"]
    translation = load_translation(base)
    if a.rev.isdecimal() and translation["doc_rev"].isdecimal() and int(a.rev) < int(translation["doc_rev"]):
        raise SystemExit(f"source revision {a.rev} is older than the recorded revision {translation['doc_rev']}")
    same_revision = a.rev == translation["doc_rev"]
    if same_revision and (sha(source) != translation["source_sha256"] or sha(md) != translation["translation_sha256"]):
        raise SystemExit("source or English translation changed without a new source revision")

    figure_dir = Path(a.figs)
    staged = {f.name: f.read_text(encoding="utf-8") for f in figure_dir.glob("fig-*.svg")} if figure_dir != OUT else {}
    figures = {f["file"]: f["svg"] for f in referenced_figures(md, OUT, staged)}
    figure_hashes = {name: sha(svg) for name, svg in figures.items()}
    if same_revision and figure_hashes != translation["translation_figures"]:
        raise SystemExit("translation figures changed without a new source revision")
    if translation_problems(blocks, mem, figures.keys()):
        raise SystemExit("translation check failed before writing public outputs")
    for name, digest in base["figures"].items():
        if name in figures and sha(figures[name]) != digest:
            raise SystemExit(f"use a new filename for the revised historical figure {name}")

    editorial = (OUT / "logos.md").read_text(encoding="utf-8")
    baseline = md if same_revision else translation_baseline(base, translation, a.previous_source)
    merged = merge_translation(editorial, baseline, md)
    output = {}
    if not same_revision:
        translation = {"doc_rev": a.rev, "source_sha256": sha(source), "blocks": len(blocks),
                       "synced": today(), "memory_blocks": len(mem["blocks"]), "figures": len(figures),
                       "translation_sha256": sha(md),
                       "translation_figures": figure_hashes}
    if merged != editorial:
        output["logos.md"] = merged
    output.update(figures)
    output.update(edition_files(config, merged, translation, figures))
    if not same_revision:
        store_translation(md)
    write_outputs(OUT, output)
    return 0


STRINGS = {
    "en": {
        "lang": "en",
        "head": """    <title>Logos · {{TITLE}} · TWIST-J</title>
    <meta name="description" content="{{TITLE}}. A working document of the TWIST-J program: what one number J = 1 + j² and one step give for space, time, energy, matter and light, what is dictionary, and what is still missing. NON-CANONICAL.">
    <meta name="author" content="A. M. Thorn">
    <meta property="og:title" content="Logos · {{TITLE}}">
    <meta property="og:description" content="A working document of the TWIST-J program. Every sentence carries its status. NON-CANONICAL.">
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://twistj.com/logos/">
    <meta property="og:locale" content="en_US">
    <link rel="canonical" href="https://twistj.com/logos/">""",
        "eyebrow": "TWIST-J &middot; Logos",
        "byline": "A. M. Thorn",
        "version": "Working document &middot; NON-CANONICAL &middot; synced {{DATE}}",
        "foot": """The Canon is the ledger. This page is a working reading of it and carries no authority.<br>
            <a href="../canon/index.html">Public Canon</a> &middot; <a href="logos.md">plain markdown</a> &middot; <a href="#top">Back to top</a>""",
        "labels": r"T|D|C|H|O|F|candidate-T|candidate-C|reading|model|judgment|probe|interpretation|boost",
        "jsonld": True,
        "katex": """    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true}],throwOnError:false});"></script>""",
    },
    "cs": {
        "lang": "cs",
        "head": """    <title>{{TITLE}} · TWIST-J</title>
    <meta name="robots" content="noindex">""",
        "eyebrow": "TWIST-J &middot; pracovní dokument",
        "byline": "",
        "version": "Statická kopie zdrojového dokumentu &middot; revize {{REV}} &middot; obnoveno {{DATE}}",
        "foot": """Statická kopie pracovního dokumentu, NON-CANONICAL. Nic tady není silnější než řádek registru, o který se opírá.<br>
            <a href="https://twistj.com/logos/">anglická verze na twistj.com/logos</a> &middot; <a href="https://twistj.com/canon/">Public Canon</a>""",
        "labels": r"T|D|C|H|O|F|candidate-T|candidate-C|čtení|model|úsudek|sonda|výklad|boost",
        "jsonld": False,
        # the artifact viewer admits no outside stylesheet: native MathML output, no KaTeX CSS or fonts
        "katex": """    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true}],output:'mathml',throwOnError:false});"></script>""",
    },
}


def heading_navigation(body, required):
    """Reserve the simple IDs for sections; subsection IDs include their parent."""
    def title(contents):
        return html.unescape(re.sub("<[^>]+>", "", contents))

    def slug(text):
        ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
        return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")

    headings = re.compile(r"<h([23])>(.*?)</h\1>")
    sections = [(slug(title(m[2])), title(m[2])) for m in headings.finditer(body) if m[1] == "2"]
    used = {anchor for anchor, _ in sections}
    if not sections or "" in used or len(used) != len(sections) or "top" in used:
        raise SystemExit("section headings must have distinct nonempty slugs other than top")
    if missing := set(required) - used:
        raise SystemExit("missing required section IDs: " + ", ".join(sorted(missing)))
    parent = "reading"

    def add_id(match):
        nonlocal parent
        level, contents = match.groups()
        anchor = slug(title(contents))
        if level == "2":
            parent = anchor
        else:
            base = parent + "-" + (anchor or "section")
            anchor = base
            suffix = 1
            while anchor in used:
                suffix += 1
                anchor = f"{base}-{suffix}"
            used.add(anchor)
        return f'<h{level} id="{anchor}">{contents}</h{level}>'

    links = "\n".join(f'        <li><a href="#{anchor}">{html.escape(text)}</a></li>'
                      for anchor, text in sections)
    toc = f'''    <nav class="logos-toc" aria-label="Contents">
      <ul>
{links}
      </ul>
    </nav>

'''
    return toc + headings.sub(add_id, body)


def edition_metadata(edition, title):
    """Reader-facing metadata and attribution are intentionally distinct by edition."""
    description = html.escape(edition["description"], quote=True)
    if edition["kind"] == "draft":
        head = f'<title>{html.escape(title)} · Translation draft</title>\n<meta name="robots" content="noindex">'
        return head, "", "", "Local translation draft", '<a href="logos.md">Markdown draft</a>', ""
    url = edition["url"]
    canonical = f'https://github.com/mathorn1973/twist-j/tree/{edition["canon"]["tag"]}'
    display_tag = edition["canon"]["tag"].removeprefix("canon-")
    byline = "TWIST-J"
    reader_label = f'{edition["label"]} · Public Canon {display_tag} · Non-canonical · {edition["date"]}'
    headline = f"Logos · {title} ({display_tag})"
    escaped_headline = html.escape(headline, quote=True)
    safe_url = html.escape(url, quote=True)
    head = f'''    <title>{escaped_headline} · TWIST-J</title>
    <meta name="description" content="{description}">
    <meta name="author" content="{byline}">
    <meta property="og:title" content="{escaped_headline}">
    <meta property="og:description" content="{description}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="{safe_url}">
    <meta property="og:site_name" content="TWIST-J">
    <meta property="og:locale" content="en_US">
    <link rel="canonical" href="{safe_url}">
    <link rel="alternate" type="text/markdown" href="{edition["markdown"]}" title="Logos source Markdown">'''
    metadata = {
        "@context": "https://schema.org", "@type": "Article",
        "headline": title, "author": {"@type": "Organization", "name": byline},
        "url": url, "inLanguage": "en", "dateModified": edition["date"],
        "description": edition["description"], "isBasedOn": canonical,
    }
    jsonld = ('    <script type="application/ld+json">\n' +
              json.dumps(metadata, ensure_ascii=False, indent=2).replace("<", "\\u003c") +
              '\n    </script>')
    foot = (f'<a href="{canonical}">Evidence edition ({display_tag})</a> &middot; '
            f'<a href="../canon/index.html">Current Public Canon</a> &middot; '
            f'<a href="{edition["markdown"]}">Plain Markdown</a> &middot; <a href="#top">Back to top</a>')
    return head, jsonld, byline, reader_label, foot, ""


def render_html(title, note, body_md, figs, lang="en", rev="", edition=None):
    """figs: list of {"file", "svg", "caption"}; each ![caption](file) in body_md becomes an inline figure."""
    try:
        import markdown  # noqa
    except ImportError:
        raise SystemExit("python package 'markdown' missing: pip install --break-system-packages markdown")
    import markdown
    S = STRINGS[lang]
    # keep $$ blocks away from the markdown parser
    maths = []
    def stash(m):
        maths.append(m.group(1)); return "\n\nMATHBLOCK%d\n\n" % (len(maths) - 1)
    md = re.sub(r"\$\$\n(.*?)\n\$\$", stash, body_md, flags=re.S)
    body = markdown.markdown(md, extensions=["tables"], output_format="html5")
    for i, tex in enumerate(maths):
        body = body.replace("<p>MATHBLOCK%d</p>" % i, '<div class="math">$$\n%s\n$$</div>' % html.escape(tex))
    assert "MATHBLOCK" not in body
    # quieter status labels, text nodes only (before the figures go in, so SVG text stays untouched)
    label = re.compile(r"\[(%s)(?=[\]\s,:;])[^\]]*\]" % S["labels"])
    parts = re.split(r"(<[^>]+>)", body)
    body = "".join(p if p.startswith("<") else label.sub(lambda m: '<span class="st">%s</span>' % m.group(0), p)
                   for p in parts)
    # figures: inline SVG with the page's colour variables
    for fig in figs:
        svg = fig["svg"]
        for hexc, var in FIG_COLOURS:
            svg = svg.replace(hexc, var)
        pat = re.compile(r'<p><img alt="[^"]*" src="%s"\s*/?></p>' % re.escape(fig["file"]))
        assert len(pat.findall(body)) == 1, fig["file"]
        caption = html.escape(fig["caption"])
        if edition and edition["kind"] != "draft":
            label = html.escape(fig["caption"], quote=True)
            asset = html.escape(fig["file"], quote=True)
            figure = (f'<figure><div class="logos-figure-graphic" role="region" tabindex="0" '
                      f'aria-label="{label}">{svg}</div><figcaption>{caption} '
                      f'<a href="{asset}">Open diagram</a></figcaption></figure>')
            body = pat.sub(lambda _: figure, body)
        else:
            body = pat.sub(lambda m: '<figure>%s<figcaption>%s</figcaption></figure>' % (
                svg.replace("\\", "\\\\"), caption), body)
    if edition and edition["kind"] != "draft":
        body = heading_navigation(body, edition.get("required_sections", []))
    tpl = TEMPLATE.read_text(encoding="utf-8")
    jsonld = ""
    if S["jsonld"]:
        jsonld = ("""    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Article", "headline": "{{TITLE}}",
     "author": [ { "@type": "Person", "name": "A. M. Thorn" } ], "url": "https://twistj.com/logos/",
     "inLanguage": "en", "dateModified": "{{DATE}}",
     "description": "A working document of the TWIST-J program, NON-CANONICAL: what one number and one step give for space, time, energy, matter and light, and what is still missing."}
    </script>""")
    reader_assets = nav = body_class = fonts = html_class = ""
    if lang == "en":
        reader_assets = """
    <script src="../reading.js"></script>
    <link rel="stylesheet" href="../reading.css">
    <link rel="stylesheet" href="../site-nav.css">
    <link rel="stylesheet" href="../core/reader.css">"""
        nav = """
    <nav id="top" class="site-nav" aria-label="Main navigation">
        <a href="../index.html">TWIST-J</a>
        <a href="../questions/index.html">Questions</a>
        <a href="../canon/index.html">Public Canon</a>
    </nav>"""
        body_class = ' class="logos-reader"'
        html_class = ' class="reader-page"'
    else:
        fonts = """    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">"""
    head, byline, version, foot = S["head"], S["byline"], S["version"], S["foot"]
    note_class = "note"
    if edition:
        head, jsonld, byline, version, foot, other = edition_metadata(edition, title)
        note_class += " logos-edition-note"
        if other:
            nav = nav.replace("    </nav>", "        " + other + "\n    </nav>")
    page = (tpl.replace("{{LANG}}", S["lang"]).replace("{{HEAD}}", head).replace("{{JSONLD}}", jsonld)
            .replace("{{EYEBROW}}", S["eyebrow"]).replace("{{BYLINE}}", byline).replace("{{VERSION}}", version)
            .replace("{{FOOT}}", foot).replace("{{KATEX}}", S["katex"])
            .replace("{{NOTE}}", (f'        <div class="{note_class}">{html.escape(note)}</div>\n' if note else ""))
            .replace("{{BODY}}", body)
            .replace("{{FONTS}}", fonts).replace("{{READERASSETS}}", reader_assets)
            .replace("{{NAV}}", nav).replace("{{BODYCLASS}}", body_class).replace("{{HTMLCLASS}}", html_class))
    page = page.replace("{{TITLE}}", html.escape(title)).replace("{{DATE}}", edition["date"] if edition else today()).replace("{{REV}}", html.escape(str(rev)))
    page = page.replace('        <div class="byline"></div>\n', "")
    assert "{{" not in page, re.findall(r"{{[A-Z]+}}", page)
    return page


FIG_COLOURS = [("#1c1c1c", "var(--text-bright)"), ("#6a6a6a", "var(--muted)"),
               ("#454545", "var(--text)"), ("#c4c4c4", "var(--rule)"), ("#b4532a", "var(--accent)")]

JSX_COLOURS = {"ink": "#1c1c1c", "quiet": "#6a6a6a", "edge": "#454545", "grid": "#c4c4c4", "accent": "#b4532a"}
JSX_ATTRS = {"fontSize": "font-size", "fontWeight": "font-weight", "strokeWidth": "stroke-width",
             "strokeDasharray": "stroke-dasharray", "markerEnd": "marker-end", "textAnchor": "text-anchor",
             "fillOpacity": "fill-opacity", "strokeLinecap": "stroke-linecap", "strokeLinejoin": "stroke-linejoin"}


def jsx_to_svg(code: str) -> str:
    """The figure nodes of the source document are small JSX modules returning one <svg>. Make a static SVG:
    colour variables become the fixed colours, `const` numbers are evaluated, camelCase attributes renamed."""
    consts = {}
    for name, val in re.findall(r"\b([a-zA-Z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)", code.split("return")[0]):
        consts[name] = float(val) if "." in val else int(val)
    body = code[code.index("<svg"):code.rindex("</svg>") + len("</svg>")]
    def expr(m):
        e = m.group(1).strip()
        if e in JSX_COLOURS:
            return '"%s"' % JSX_COLOURS[e]
        if e[:1] in "'\"":
            return '"%s"' % e.strip("'\"")
        if not re.fullmatch(r"[\w\s+\-*/().]+", e):
            raise SystemExit("unsupported JSX expression: {%s}" % e)
        val = eval(e, {"__builtins__": {}}, dict(consts))  # arithmetic on the declared constants only
        return '"%s"' % (int(val) if float(val).is_integer() else val)
    body = re.sub(r"=\{([^}]*)\}", lambda m: "=" + expr(m), body)
    for k, v in JSX_ATTRS.items():
        body = re.sub(r"\b%s=" % k, v + "=", body)
    body = re.sub(r"\s+data-claude-[a-z-]+='[^']*'", "", body)
    body = body.replace("'", '"')
    if "xmlns=" not in body[:200]:
        body = body.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
    return body + "\n"


def cmd_jsx2svg(a):
    svg = jsx_to_svg(Path(a.jsx).read_text(encoding="utf-8"))
    import xml.dom.minidom
    xml.dom.minidom.parseString(svg)  # well-formed or raise
    Path(a.out).write_text(svg, encoding="utf-8")
    print("%s -> %s (%d bytes)" % (a.jsx, a.out, len(svg)))
    return 0


def cmd_build_cs(a):
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    mem = load_memory()
    figdir, outdir = Path(a.figs), Path(a.out)
    parts, figs = [], []
    title = None
    for b in blocks:
        if b["kind"] == "byline":
            continue
        if b["kind"] == "title":
            title = b["cs"][2:].strip(); continue
        if b["kind"] == "figure":
            cap = FIGURE.match(b["cs"]).group(1)
            fig = mem["figures"].get(sha(cap))
            if not fig:
                raise SystemExit("figure not in memory: %s" % cap)
            svg_path = figdir / fig["file"]
            if not svg_path.exists():
                raise SystemExit("Czech figure missing: %s (make it with jsx2svg from the node code)" % svg_path)
            svg = svg_path.read_text(encoding="utf-8")
            figs.append({"file": fig["file"], "svg": svg, "caption": cap})
            parts.append("![%s](%s)" % (cap, fig["file"]))
        else:
            parts.append(b["cs"])
    if not title:
        raise SystemExit("no title block")
    body_md = "\n\n".join(parts) + "\n"
    note = ("Pracovní dokument programu TWIST-J, NON-CANONICAL. Statická kopie zdrojového dokumentu v jeho "
            "revizi %s, obnovovaná automaticky spolu s anglickou verzí na twistj.com/logos. "
            "Nic tady není silnější než řádek registru, o který se opírá." % a.rev)
    page = render_html(title, note, body_md, figs, "cs", a.rev)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "index.html").write_text(page, encoding="utf-8")
    data = (outdir / "index.html").read_bytes()
    print("%s  %d bytes  sha256 %s" % (outdir / "index.html", len(data), hashlib.sha256(data).hexdigest()))
    return 0


def translation_problems(blocks, mem, figures):
    failures = 0
    for i, block in enumerate(blocks):
        kind = block["kind"]
        if kind in ("text", "title"):
            en = mem["blocks"].get(block["sha"])
            problems = ["no English"] if not en else block_problems(block["cs"], en["en"])
        elif kind == "figure":
            cap = FIGURE.match(block["cs"]).group(1)
            fig = mem["figures"].get(sha(cap))
            problems = ["no English figure"] if not fig else (
                [] if fig["file"] in figures else ["missing figure " + fig["file"]])
        else:
            problems = []
        if problems:
            failures += 1
            print("block %d (%s): %s" % (i, kind, "; ".join(problems)))
    return failures


def cmd_check(a):
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    mem = load_memory()
    figure_paths = {f.name for directory in (OUT, Path(a.figs)) for f in directory.glob("fig-*.svg")}
    failures = translation_problems(blocks, mem, figure_paths)
    if not failures:
        expected = translated_markdown(blocks, mem)
        if a.markdown:
            actual = Path(a.markdown).read_text(encoding="utf-8")
            if actual != expected:
                failures += 1
                print("supplied English Markdown differs from the source translation")
        else:
            config = load_config()
            base = config["initial_translation"]
            translation = load_translation(base)
            if translation["source_sha256"] != sha(source) or sha(expected) != translation["translation_sha256"]:
                failures += 1
                print("source or translation differs from the recorded public baseline")
            actual_figures = {f["file"]: sha(f["svg"]) for f in referenced_figures(expected, OUT)}
            if actual_figures != translation["translation_figures"]:
                failures += 1
                print("translation figure checksums differ from the recorded public baseline")
            editorial = (OUT / "logos.md").read_text(encoding="utf-8")
            output = edition_files(config, editorial, translation)
            for name, contents in output.items():
                if (OUT / name).read_text(encoding="utf-8") != contents:
                    failures += 1
                    print(f"{name} differs from the generated public edition")
    print("check: %d problem block(s) or output(s), %d source blocks" % (failures, len(blocks)))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("normalize"); p.add_argument("export"); p.add_argument("out"); p.set_defaults(f=cmd_normalize)
    p = sp.add_parser("plan"); p.add_argument("source"); p.add_argument("pending"); p.set_defaults(f=cmd_plan)
    p = sp.add_parser("fill"); p.add_argument("pending"); p.add_argument("english"); p.add_argument("--source"); p.set_defaults(f=cmd_fill)
    p = sp.add_parser("apply"); p.add_argument("pending"); p.set_defaults(f=cmd_apply)
    p = sp.add_parser("figure"); p.add_argument("--caption-sha", required=True); p.add_argument("--en-caption", required=True)
    p.add_argument("--file", required=True); p.add_argument("--jsx", required=True)
    p.add_argument("--figs", default=OUT); p.set_defaults(f=cmd_figure)
    p = sp.add_parser("build-edition"); p.set_defaults(f=cmd_build_edition)
    p = sp.add_parser("build"); p.add_argument("source"); p.add_argument("--rev", required=True)
    p.add_argument("--out"); p.add_argument("--figs", default=OUT)
    p.add_argument("--previous-source", help="verified normalized Czech source for the last translated revision")
    p.set_defaults(f=cmd_build)
    p = sp.add_parser("check"); p.add_argument("source"); p.add_argument("--markdown")
    p.add_argument("--figs", default=OUT); p.set_defaults(f=cmd_check)
    p = sp.add_parser("jsx2svg"); p.add_argument("jsx"); p.add_argument("out"); p.set_defaults(f=cmd_jsx2svg)
    p = sp.add_parser("build-cs"); p.add_argument("source"); p.add_argument("--rev", required=True)
    p.add_argument("--figs", required=True); p.add_argument("--out", required=True); p.set_defaults(f=cmd_build_cs)
    a = ap.parse_args()
    sys.exit(a.f(a) or 0)


if __name__ == "__main__":
    main()
