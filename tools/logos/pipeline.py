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
    figs = [{"file": f["file"], "svg": (OUT / f["file"]).read_text(encoding="utf-8"), "caption": f["en_caption"]}
            for f in mem["figures"].values()]
    page = render_html(title, note, body_md, figs, "en", a.rev)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    src = {"doc_rev": a.rev, "source_sha256": sha(source), "blocks": len(blocks),
           "synced": today(), "memory_blocks": len(mem["blocks"]), "figures": len(mem["figures"])}
    (OUT / "SOURCE.json").write_text(json.dumps(src, indent=1) + "\n", encoding="utf-8")
    for fn in ("logos.md", "index.html", "SOURCE.json"):
        data = (OUT / fn).read_bytes()
        print("%-12s %7d bytes  sha256 %s" % (fn, len(data), hashlib.sha256(data).hexdigest()))
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
            <a href="/canon/">Public Canon</a> &middot; <a href="/logos/logos.md">plain markdown</a> &middot; <a href="/">twistj.com</a>""",
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


def render_html(title, note, body_md, figs, lang="en", rev=""):
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
        body = pat.sub(lambda m: '<figure>%s<figcaption>%s</figcaption></figure>' % (
            svg.replace("\\", "\\\\"), html.escape(fig["caption"])), body)
    tpl = TEMPLATE.read_text(encoding="utf-8")
    jsonld = ""
    if S["jsonld"]:
        jsonld = ("""    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Article", "headline": "{{TITLE}}",
     "author": [ { "@type": "Person", "name": "A. M. Thorn" } ], "url": "https://twistj.com/logos/",
     "inLanguage": "en", "dateModified": "{{DATE}}",
     "description": "A working document of the TWIST-J program, NON-CANONICAL: what one number and one step give for space, time, energy, matter and light, and what is still missing."}
    </script>""")
    page = (tpl.replace("{{LANG}}", S["lang"]).replace("{{HEAD}}", S["head"]).replace("{{JSONLD}}", jsonld)
            .replace("{{EYEBROW}}", S["eyebrow"]).replace("{{BYLINE}}", S["byline"]).replace("{{VERSION}}", S["version"])
            .replace("{{FOOT}}", S["foot"]).replace("{{KATEX}}", S["katex"])
            .replace("{{NOTE}}", html.escape(note)).replace("{{BODY}}", body))
    page = page.replace("{{TITLE}}", html.escape(title)).replace("{{DATE}}", today()).replace("{{REV}}", html.escape(str(rev)))
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
    p = sp.add_parser("jsx2svg"); p.add_argument("jsx"); p.add_argument("out"); p.set_defaults(f=cmd_jsx2svg)
    p = sp.add_parser("build-cs"); p.add_argument("source"); p.add_argument("--rev", required=True)
    p.add_argument("--figs", required=True); p.add_argument("--out", required=True); p.set_defaults(f=cmd_build_cs)
    a = ap.parse_args()
    sys.exit(a.f(a) or 0)


if __name__ == "__main__":
    main()
