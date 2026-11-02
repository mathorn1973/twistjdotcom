#!/usr/bin/env python3
"""Logos pipeline: Czech working document (a Claude Doc) -> English page at https://twistj.com/logos/.

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
  build SOURCE.md --rev REV         write logos/logos.md, logos/index.html, logos/SOURCE.json
  check SOURCE.md                   verify the English against the Czech source, exit 1 on failure

Exact text, no network, Python standard library plus the markdown package for the HTML step.
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools" / "logos"
OUT = ROOT / "logos"
MEMORY = TOOLS / "memory.json"
TEMPLATE = TOOLS / "template.html"

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
    svg_path = OUT / a.file
    if not svg_path.exists():
        print("logos/%s does not exist; write the English SVG first" % a.file); return 1
    svg = svg_path.read_text(encoding="utf-8")
    if CZECH.search(svg):
        print("logos/%s still contains Czech diacritics" % a.file); return 1
    mem["figures"][a.caption_sha] = {"en_caption": a.en_caption, "file": a.file,
                                     "jsx_sha": sha(jsx), "added": today()}
    save_memory(mem)
    print("figure registered: %s -> %s" % (a.caption_sha[:12], a.file))
    return 0


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
            out.append((b["kind"], en["en"], None))
    return out


def cmd_build(a):
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    mem = load_memory()
    en = english_blocks(blocks, mem)
    title = next(t for k, t, _ in en if k == "title")[2:].strip()
    body_md = "\n\n".join(t for k, t, _ in en if k != "title") + "\n"
    note = ("Working document of the TWIST-J program, NON-CANONICAL. Translated from the Czech working "
            "original, which is not published; the translation is machine-made and synced automatically "
            "from the source document. Nothing here is stronger than the registry row it rests on.")
    md = "# %s\n\n%s\n\n%s" % (title, note, body_md)
    OUT.mkdir(exist_ok=True)
    (OUT / "logos.md").write_text(md, encoding="utf-8")
    page = render_html(title, note, body_md, mem)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    src = {"doc_rev": a.rev, "source_sha256": sha(source), "blocks": len(blocks),
           "synced": today(), "memory_blocks": len(mem["blocks"]), "figures": len(mem["figures"])}
    (OUT / "SOURCE.json").write_text(json.dumps(src, indent=1) + "\n", encoding="utf-8")
    for fn in ("logos.md", "index.html", "SOURCE.json"):
        data = (OUT / fn).read_bytes()
        print("%-12s %7d bytes  sha256 %s" % (fn, len(data), hashlib.sha256(data).hexdigest()))
    return 0


def render_html(title, note, body_md, mem):
    try:
        import markdown  # noqa
    except ImportError:
        raise SystemExit("python package 'markdown' missing: pip install --break-system-packages markdown")
    import markdown
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
    label = re.compile(r"\[(T|D|C|H|O|F|candidate-T|candidate-C|reading|model|judgment|probe|interpretation|boost)(?=[\]\s,:])[^\]]*\]")
    parts = re.split(r"(<[^>]+>)", body)
    body = "".join(p if p.startswith("<") else label.sub(lambda m: '<span class="st">%s</span>' % m.group(0), p)
                   for p in parts)
    # figures: inline SVG with the page's colour variables
    for fig in mem["figures"].values():
        svg = (OUT / fig["file"]).read_text(encoding="utf-8")
        for hexc, var in FIG_COLOURS:
            svg = svg.replace(hexc, var)
        pat = re.compile(r'<p><img alt="[^"]*" src="%s"\s*/?></p>' % re.escape(fig["file"]))
        assert len(pat.findall(body)) == 1, fig["file"]
        body = pat.sub(lambda m: '<figure>%s<figcaption>%s</figcaption></figure>' % (
            svg.replace("\\", "\\\\"), html.escape(fig["en_caption"])), body)
    tpl = TEMPLATE.read_text(encoding="utf-8")
    return (tpl.replace("{{TITLE}}", html.escape(title)).replace("{{NOTE}}", html.escape(note))
            .replace("{{DATE}}", today()).replace("{{BODY}}", body))


FIG_COLOURS = [("#1c1c1c", "var(--text-bright)"), ("#6a6a6a", "var(--muted)"),
               ("#454545", "var(--text)"), ("#c4c4c4", "var(--rule)"), ("#b4532a", "var(--accent)")]


def cmd_check(a):
    source = Path(a.source).read_text(encoding="utf-8")
    blocks = split_blocks(source)
    mem = load_memory()
    failures = 0
    for i, b in enumerate(blocks):
        if b["kind"] in ("text", "title"):
            en = mem["blocks"].get(b["sha"])
            probs = ["no English"] if not en else block_problems(b["cs"], en["en"])
        elif b["kind"] == "figure":
            cap = FIGURE.match(b["cs"]).group(1)
            fig = mem["figures"].get(sha(cap))
            probs = ["no English figure"] if not fig else (
                [] if (OUT / fig["file"]).exists() else ["missing file logos/%s" % fig["file"]])
        else:
            probs = []
        if probs:
            failures += 1
            print("block %d (%s): %s" % (i, b["kind"], b["cs"][:50].replace("\n", " ")))
            for p in probs:
                print("   " + p)
    md = (OUT / "logos.md")
    if md.exists():
        text = md.read_text(encoding="utf-8")
        for bad in ("[embedded content", "MATHBLOCK", "&#91;"):
            if bad in text:
                failures += 1; print("logos.md contains %r" % bad)
        if text.count("$$") % 2:
            failures += 1; print("logos.md has unbalanced $$")
        en_blocks = [x for x in split_blocks(text) if x["kind"] != "byline"]
        cs_blocks = [x for x in blocks if x["kind"] != "byline"]
        # logos.md = title + note + body; source (byline dropped) = title + body
        if len(en_blocks) != len(cs_blocks) + 1:
            failures += 1
            print("block count differs: logos.md %d vs source %d + note" % (len(en_blocks), len(cs_blocks)))
    print("check: %d problem block(s), %d blocks total" % (failures, len(blocks)))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("normalize"); p.add_argument("export"); p.add_argument("out"); p.set_defaults(f=cmd_normalize)
    p = sp.add_parser("plan"); p.add_argument("source"); p.add_argument("pending"); p.set_defaults(f=cmd_plan)
    p = sp.add_parser("fill"); p.add_argument("pending"); p.add_argument("english"); p.add_argument("--source"); p.set_defaults(f=cmd_fill)
    p = sp.add_parser("apply"); p.add_argument("pending"); p.set_defaults(f=cmd_apply)
    p = sp.add_parser("figure"); p.add_argument("--caption-sha", required=True); p.add_argument("--en-caption", required=True)
    p.add_argument("--file", required=True); p.add_argument("--jsx", required=True); p.set_defaults(f=cmd_figure)
    p = sp.add_parser("build"); p.add_argument("source"); p.add_argument("--rev", required=True); p.set_defaults(f=cmd_build)
    p = sp.add_parser("check"); p.add_argument("source"); p.set_defaults(f=cmd_check)
    a = ap.parse_args()
    sys.exit(a.f(a) or 0)


if __name__ == "__main__":
    main()
