# Logos sync runbook

`https://twistj.com/logos/` is the English mirror of a Czech working document that is edited elsewhere
and is not published. The mirror is kept by an automatic sync: a scheduled session runs this runbook.
Nothing on the page is stronger than the registry row it rests on; the page is NON-CANONICAL.

What lives in this repository: `logos/index.html` (the page), `logos/logos.md` (the same text as plain
markdown, for agents), `logos/fig-*.svg` (the figures), `logos/SOURCE.json` (which source revision the
page mirrors) and `tools/logos/memory.json` (the translation memory: SHA-256 of each Czech block, the
English block, nothing else). The Czech text itself is never committed. The link to the source document
lives in the scheduled task, not here.

## Procedure

```
0  Preconditions. A clone of mathorn1973/twistjdotcom at main with push rights; python3 with the
   `markdown` package (pip install --break-system-packages markdown if missing). All work files go
   to a directory OUTSIDE the repository, call it WORK.
1  Currency. Read the source document and take its current revision number. Compare with
   logos/SOURCE.json field doc_rev. Equal: stop, report "no change", touch nothing.
2  Export. Export the document as markdown to WORK/export.md and as html to WORK/export.html
   (the html carries the figure node ids: <figure data-embed="node/ID">).
3  Plan.   python3 tools/logos/pipeline.py normalize WORK/export.md WORK/source.md
           python3 tools/logos/pipeline.py plan WORK/source.md WORK/pending.json
   The plan lists the text blocks without English and the state of every figure.
4  Figures. For each figure the plan lists: take its node id from WORK/export.html, read the node's
   code, save it to WORK/figN.jsx exactly as returned followed by one newline (the recorded jsx_sha
   values are taken that way). If the plan says "known" and sha256 of that file equals the
   recorded jsx_sha, nothing to do. Otherwise write the English SVG to logos/<file>: convert the JSX
   to a static SVG exactly as the existing logos/fig-*.svg files are built (colours ink #1c1c1c,
   quiet #6a6a6a, edge #454545, grid #c4c4c4, accent #b4532a; camelCase attributes to SVG names;
   data-claude-* attributes dropped), translate the text labels only, keep the geometry, and widen
   the viewBox rather than shrinking text when an English label runs long. Then register it:
           python3 tools/logos/pipeline.py figure --caption-sha S --en-caption "..." --file fig-x.svg --jsx WORK/figN.jsx
5  Translate. Write the English of every pending block, in the order of WORK/pending.json, one block
   per item, blocks separated by one blank line, into WORK/english.md. Rules:
     - numbers stay digits where the source has digits, words where it has words; every number,
       superscript and subscript must reappear;
     - every status label ([T], [D], [C], [H], [O], [F], [candidate-T], [candidate-C]) and every
       registry id (UPPER-CASE-WITH-HYPHENS) is kept exactly; [čtení] becomes [reading],
       [úsudek] becomes [judgment], [model] stays, [sonda ...] becomes [probe ...],
       [výklad ...] becomes [interpretation ...];
     - tables keep their rows, lists their items, headings their level;
     - if a block is a small edit of a paragraph that already has English (see context_before_en,
       context_after_en and logos/logos.md), keep the existing wording and change only what changed;
     - the glossary below is binding.
           python3 tools/logos/pipeline.py fill WORK/pending.json WORK/english.md
           python3 tools/logos/pipeline.py apply WORK/pending.json
   apply rejects a block that drops a number, a label or an id, or still carries Czech letters.
   Fix the English and apply again. Never fix a rejection by changing a number: if the source
   itself looks wrong, stop and report.
6  Build.  python3 tools/logos/pipeline.py build WORK/source.md --rev <revision from step 1>
           python3 tools/logos/pipeline.py check WORK/source.md
   check must end with "0 problem block(s)".
7  Review. git diff logos/logos.md once. The diff must contain only the paragraphs that changed in
   the source. Anything else means a block was mis-aligned: stop and report.
8  Commit and push. Audit the staged files first: only logos/, tools/logos/memory.json and, if the
   date changed, sitemap.xml; no secrets, no private hostnames, no link to the source document.
   Commit as A. M. Thorn <thorn@twistj.com>, message "logos: sync to source rev N", push to main.
9  Report in one paragraph: the revision synced, how many blocks were new, which figures changed,
   or "no change".
```

Stop without guessing when the export fails, when a rejection cannot be fixed without altering a
number or a label, when check fails, when the diff touches paragraphs the source did not change, or
when the push is rejected. A stopped sync leaves the repository untouched.

## Glossary (Czech to English, binding)

```
účet            account          místo          slot            kontakt        contact
brána           gate             odmítnutí      refusal         přijetí        acceptance
značka          mark             hladina        shell           dráha          orbit
dno             floor            hloubka        depth           tik            tick
čítač           counter          slovo          word            banka          bank
sada            set              archiv         archive         připravenost   readiness
závora          barrier          přepínač       switch          spouštěč       trigger
řadič           controller       zdroj značek   source of marks zdroj příchodů source of arrivals
ciferník        dial             razítko        stamp           stopky         stopwatch
pojistka        fuse             čtení          reading         slovník        dictionary
věta            theorem          plénum         plenum          ustálený běh   steady run
list            sheet            písmeno        letter          mince          coin
slupka hmoty    mass shell       chodec         walker          příčka         rung
zbytek          residue          střih          shear           relace         session
přezkum         review           smlouva        contract        sonda          probe
most            bridge           kotva          anchor          setrvačnost    inertia
šipka           arrow            Kánon          Canon           řádek          row
stavba katedrály   cathedral build         stavba malý vesmír   small universe build
```
