# Logos editions

The public English reading at `https://twistj.com/logos/` is edited in
`logos/logos.md`. It is a non-canonical editorial revision of the historical
reading, with its own evidence basis recorded in `tools/logos/editions.json`.
Changes to the English edition are editorial changes. They do not imply any
change to the private Czech working document.

The public provenance file, `logos/SOURCE.json`, records the Czech source
revision, the verified English translation digest, and the current reading's
evidence, output hashes and figures. The normalized Czech source is private.
Revision 124 remains the initial translation reference for source sync.

## English editorial build

1. Verify the intended evidence edition against authoritative `STATUS.md` in
   the scientific repository. Record its release tag, content commit and
   Canon hash in `tools/logos/editions.json`. Set the editorial date explicitly.
   Check every specific claim against its frozen registry row. Keep the
   source dates and live links distinguishable from edition-specific citations.
2. Edit `logos/logos.md`. Begin with one H1 title, use unique H2 section
   headings and H3 subheadings, and put multiline `$$` formula fences on their
   own lines. Keep the required section slugs in `editions.json` stable.
   Diagrams are separate paragraphs such as `![Plain caption](fig-name.svg)`,
   using a local, uniquely named SVG. Give any revision to a historical
   diagram a new filename.
3. Run `python -B tools/logos/check_frontier.py CANON_DIRECTORY` against the
   pinned scientific directory with `REGISTRY.tsv` and `FRONTIER.md`. The
   optional `--markdown FILE` checks an alternate working manuscript. Review
   the link anchors, labels and scientific scope independently of rendering.
4. With Python and Python-Markdown installed, run
   `python -B tools/logos/pipeline.py build-edition`. This generates
   `logos/index.html` and `logos/SOURCE.json` from the current Markdown.
   It works in a shallow checkout without the Czech source or old Git objects
   and leaves the Markdown untouched.
5. Review the diff and test the navigation, narrow layout, diagrams and
   formulas. Repeating the same build with the same configuration,
   Python-Markdown 3.11.3 and inputs should produce the same UTF-8/LF hashes.
   Confirm that no private source, identifiers or exports entered the
   change. Publish only within the separately authorized website procedure.

## Review a future translation

The Czech working document and its private static copy belong to the
owner. Their references live in the scheduled task, outside this repository.
Keep their export, temporary translations and Czech assets under `WORK`,
outside the repository. The scheduled workflow still uses the top-level
source revision and hash in SOURCE.json. For a new revision, the default
build merges the incoming English translation into the current manuscript
using the last English translation as its base. The first merge from
revision 124 reads its pinned Git blob and checks its SHA-256. If a shallow
checkout lacks that blob, fetch the relevant history or supply
`--previous-source WORK/previous.md` with the exact normalized Czech
revision 124. The pipeline verifies its source hash and checks that the
reconstructed English translation matches the pinned digest. Later merges
use the tracked `logos/translation.md` baseline and verify its digest.
Overlapping edits stop the build before public outputs change and name
the affected sections.

1. Export the owner-approved Czech revision as `WORK/export.md` and HTML
   as `WORK/export.html`. Match each embedded figure to its source node and
   keep the exact JSX with one trailing newline.
2. Run `pipeline.py normalize WORK/export.md WORK/source.md` and
   `pipeline.py plan WORK/source.md WORK/pending.json`. Compare the recorded
   revision and hash against the last approved translation review.
3. Translate only pending blocks. Preserve every number, superscript,
   subscript, scope label, claim ID, heading level and table/list layout.
   Preserve unchanged wording. Review edition-specific citation targets.
   Run `pipeline.py fill WORK/pending.json WORK/english.md`, then
   `pipeline.py apply WORK/pending.json` in the isolated working checkout.
4. Reuse the known English figures where their node hashes match. Convert
   each new node with `pipeline.py jsx2svg WORK/figN.jsx WORK/figs/fig-name.svg`,
   translate labels and register it with `pipeline.py figure` using
   `--caption-sha`, `--en-caption`, `--file`, `--jsx` and `--figs WORK/figs`.
   Never overwrite a shared historical diagram. If a diagram changes, use
   a new asset filename and keep the recorded historical source mapping.
5. Run `pipeline.py build WORK/source.md --rev REV`. Include `--figs WORK/figs`
   for staged new diagrams. The current English Markdown receives the
   incoming translation changes while non-overlapping editorial edits
   remain. Run `pipeline.py check WORK/source.md`. It checks the actual
   translation baseline and the generated HTML/provenance against the
   current public Markdown. A repeated build for an identical source
   revision leaves the outputs unchanged. An optional `--out WORK/en`
   builds an isolated draft; check it with `--markdown WORK/en/logos.md`.
6. Review the generated diff, preserving the editorial context and frozen
   evidence labels. In the authorized scheduled workflow, commit the
   merged manuscript, generated files, translation baseline, new figures,
   translation memory and relevant discovery dates, then push as usual.
   A merge conflict stops publication before any generated file is changed.
7. Continue the existing private Czech copy workflow. Render the source
   with `build-cs`, supplying the Czech SVGs made from all source JSX nodes
   and an output directory under `WORK`. Use the scheduled task's private
   artifact slug and version to republish the Czech static copy. Keep its
   HTML, figures and source export out of the public repository.

Stop if the export or figure identity cannot be verified, if the
translation check fails, or if the generated diff contains unauthorized
changes. Preserve pinned citations to historical Canon releases where they are needed.

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
