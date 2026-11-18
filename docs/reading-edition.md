# TWIST-J reading edition

## Local edition after the November deposits

Start at the [home page](../index.html). Follow the two integer steps to the [kernel](../core/index.html), the [contact and record example](../reading/contact/index.html) or [Papers](../papers/index.html). The home page and library use relative paths, so this reading sequence also works when opened directly from disk. For the applications and live Canon readers, serve the checkout as a static site. The production website revision at the start of this change was `818e9bcef885769f1baf806662595677c4cfb20f`.

| Paper | Edition DOI | Files in deposit |
| --- | --- | ---: |
| [Twist Numbers](../papers/twist-numbers/index.html) | [10.5281/zenodo.24326776](https://doi.org/10.5281/zenodo.24326776) | 3 |
| [Magic Numbers](../papers/magic-numbers/index.html) | [10.5281/zenodo.24326767](https://doi.org/10.5281/zenodo.24326767) | 5 |
| [The Hyperbolic J Map](../papers/hyperbolic-j/index.html) | [10.5281/zenodo.24326803](https://doi.org/10.5281/zenodo.24326803) | 4 |
| [Twist Algebra](../papers/twist-algebra/index.html) | [10.5281/zenodo.24326818](https://doi.org/10.5281/zenodo.24326818) | 4 |

All four edition DOIs resolved to their respective public Zenodo records on 18 November 2026. The [file manifest](../papers/manifest.json) lists every deposited file with its size, Zenodo MD5 and SHA-256. The complete HTML articles and interactive guides are reading copies provided by the website. Their head metadata identifies the exact TeX manuscript used. Each paper's landing page carries the edition citation, the DOI for all versions and the author's ORCID.

Run `python -B verify/paper_mirrors.py` from the repository root to check the mirrors, manuscript fingerprints and edition citations offline. Run `python -B verify/kernel_identities.py` for the exact integer identities. The [sitemap](../sitemap.xml) and [machine index](../llms.txt) describe the same routes as the home page. Modification dates for existing routes follow their page history.

The [Logos reading](../logos/index.html) and its [Markdown edition](../logos/logos.md) were rebuilt from source revision 124. Five historical citations point to the `canon-v109` tag for the status, registry, frontier, two-site contact notes and four-slot minimum probe. The HTML footer links to the current Canon.

The current Evo app can share four settings the older subdomain cannot read: target density, viscosity, solidification strength and its toggle. Share and Lock & Share in this checkout point to `https://twistj.com/evo/`, which reads all four. The fragment format is preserved. Existing links on the subdomain still depend on the application served there.

In a fresh local browser, Evo restored both a legacy dot-separated fragment and the four settings above. Lock & Share restored the locked state. Fractal restored the centre, scale and audio level in Mandelbrot, Julia and split views, including the Julia parameter where applicable. The tests captured the URL passed to the clipboard and reopened its fragment in a fresh page. The four paper guides were exercised at widths of 390 and 1280 pixels. The home and contact pages were also checked at 320 pixels and in print mode.

The [research question index](../questions/index.html) pairs six results with their open obligations. Each entry has a stable fragment and cites the relevant passage or registry row in Public Canon v113. Its link to the live Frontier follows later editions. The opening links on every HTML page lead directly to the home page and the question index, including the papers, guides, applications and archived preview.

Three questions also have hands-on examples. [Pentaplex](../pentaplex/index.html?scheme=polar#wrap) colours a finite patch using a second embedding. The [two-site contact](../demolab/index.html#contact-cycle) lets the reader step through an admitted pair and a refused pair. [Ordinary Quantum](../oq/index.html#measurement) compares two measurement bases for the same state. The index links the mathematical claims to their Canon passages. The [console guide](../oq/README.md) also covers Grover search, continuous rotations and sharing circuits with Matematyka.

The reading edition and its applications use English throughout. The former Czech Manifest address redirects to the English edition so that existing bookmarks still work.

## Original review and migration plan

The 18 November review below documents the site before consolidation and the [three-page prototype](../reading-preview/index.html). Its [paper shelf](../reading-preview/papers/index.html) illustrates the June edition of *Twist Numbers*. The four November editions are available from the library above.

## What a reader encounters today

The public home page gives equal visual weight to eight destinations. Six lead to other pages on the site. “Papers” takes the reader to the author's ORCID profile. The kernel, declared architecture and limits of the decoder are already visible. A reader looking for an individual paper, its edition or an example of a recent result has to find another way in. All twelve HTML landing pages were reachable within two clicks. Navigation and currency are the first editorial problems to solve. [Website snapshot](https://github.com/mathorn1973/twistjdotcom/tree/818e9bcef885769f1baf806662595677c4cfb20f) · [Home page](https://twistj.com/)

Public Canon v113 is the scientific baseline for this review. The home page’s kernel identities still check. Its examples give little indication of the more recent work on what contact can write, what an archive retains and which readings lose information. The finite H3 result entered in v112. In v113 the selected weighted scalar incidence comparison moved from open to dictionary status. The massless-phase question remains open. The Frontier at this review held 23 open obligations and two hypotheses. Release examples should cite the precise edition. General navigation should lead to the current status. [Status at the review](https://github.com/mathorn1973/twist-j/blob/canon-v113/STATUS.md) · [Changes in v112 and v113](https://github.com/mathorn1973/twist-j/blob/canon-v113/canon/CHANGELOG.md) · [Live Frontier](https://github.com/mathorn1973/twist-j/blob/main/canon/FRONTIER.md)

Logos presents a dated working reading of v109, with 26 live obligations and hypotheses at that edition. Several source links follow the moving main branch. Treat the November reading as a dated work, retain its qualifiers and link its historical claims to the matching edition. Reassess the affected passages before offering a current reading. Its generated HTML and Markdown have a documented upstream workflow. [Published Logos](https://twistj.com/logos/) · [v109 status](https://github.com/mathorn1973/twist-j/blob/canon-v109/STATUS.md) · [Publishing workflow](https://github.com/mathorn1973/twistjdotcom/blob/818e9bcef885769f1baf806662595677c4cfb20f/tools/logos/RUNBOOK.md)

## Proposed reading order

| Reader's question | First destination | Evidence or next step |
| --- | --- | --- |
| What does one multiplication do? | Homepage, opening equation and two integer steps | Kernel reference, exact verifier, Twist Numbers |
| When does contact leave a record? | Worked example, two sites followed by a separate H3 lattice | Pinned theorem, finite record and reproduction |
| Where does the formal statement end? | Scope next to the example and a concrete failure of retention | Current Frontier and claim registry |
| What can I read and cite? | Local Papers shelf | Exact version DOI, full paper, source, author profile |
| What can I try? | Existing Demo Lab and Ordinary Quantum | Each instrument's own scope, controls and documentation |

Keep each question at a stable URL. Use a short argument and a worked example before offering an interactive instrument. Where the reader needs a diagram, provide it at that point. This prototype uses one column, a system serif, underlined links and native MathML. It needs no image, font download, script or account to read.

## Route and migration inventory

| Existing address | Intended place in the revised site | Acceptance check before switching the home page |
| --- | --- | --- |
| `/` | Reading entry at the same address | Preserve external entry points, the `twistj-agent-card` JSON and canonical metadata. Update the human and machine summaries together. |
| `/core/` | Kernel reference reached from the first equation | Keep its verifier download and reciprocal route to the Canon overview. |
| `/canon/`, `/canon/core/` | Public record and short Canon overview | Retain raw Markdown and repository fallbacks, activation authority and live source behavior. |
| `/manifest/`, `/manifest/cs/` | Method in English | Check the old localized address redirects to the English edition. List the canonical address in the site indexes. |
| `/logos/`, `/logos/logos.md` | Dated working interpretation | Preserve HTML and Markdown, source attribution and version scope. Make future anchor changes in the generator. |
| `/demolab/`, `/pentaplex/` | Index of illustrations and an instrument | Preserve direct entry and a clear return to the lab. |
| `/fractal/` | Illustration with shareable state | Open saved fragments in Mandelbrot, Julia and split views and compare state. |
| `/evo/`, `https://evo.twistj.com/` | The current experiment and an older share target | Test Share and Lock & Share through a fresh browser. The application currently writes the subdomain and encodes state in the fragment. Verify historical links before editing that behavior. |
| `/oq/` | Standalone exact computation tool | Add the missing link to `llms.txt`. Coordinate changes inside the app with the [open worker work](https://github.com/mathorn1973/twistjdotcom/issues/16). |
| Papers link to ORCID | Proposed `/papers/` with permanent entry URLs, starting with `/papers/twist-numbers/` | Distinguish edition, series and author. Check every local download against the cited deposit. |
| `/sitemap.xml`, `/llms.txt`, `/robots.txt` | Discovery | Current sitemap lists 12 HTML landing pages and `llms.txt`. The text index directly links ten landing pages. Stage the new paths, canonical URLs, metadata and accurate dates in the migration change. |

The live checks covered all twelve HTML landing pages, the three discovery files, Logos Markdown and source metadata, and an OQ technical document. All eighteen matched the website revision cited above byte for byte. Existing public links can also address application assets, notebooks and textual evidence outside the sitemap. Preserve these paths as part of each application's migration.

Some old URLs already return 404. The former `/canon/latest.md` was a moving alias. Versioned web files such as `/canon/v177.md` predate the public numbering cutover and have identifiable historical blobs. Old `/fractalus/` was a different 3D demonstration. Keep a compatibility list for readers who report a specific citation or QR code. A replacement must match its historical target, fragment and content type. These examples do not require a new public history browser. [Old Canon file](https://github.com/mathorn1973/twistjdotcom/blob/46b90be2a3a6e379fbdca5969a8436de2541a4a9/canon/v177.md) · [Cutover](https://github.com/mathorn1973/twistjdotcom/commit/610a9f491d9c657dd88f25b9814c0e6bc9c48dc4) · [Demo consolidation](https://github.com/mathorn1973/twistjdotcom/pull/4)

## Publication pilot

The paper shelf contains two originals from the 5 June 2026 deposit, licensed CC BY 4.0. The local copy names the deposited edition, the author and the source. The edition DOI identifies the cited files. The concept DOI identifies the series. ORCID identifies the author. Readers can retrieve the paper from the local shelf if the external record becomes temporarily unavailable. [Edition](https://doi.org/10.5281/zenodo.20559777) · [Series](https://doi.org/10.5281/zenodo.19056596) · [Author](https://orcid.org/0009-0008-5463-278X)

| Mirrored file | Bytes | SHA-256 |
| --- | ---: | --- |
| [twist_numbers.pdf](../reading-preview/papers/twist_numbers.pdf) | 155107 | `d183459216030d167f073944021841d6e7c303600fcdc42cdba972ea62807172` |
| [twist_numbers.tex](../reading-preview/papers/twist_numbers.tex) | 26649 | `76f01cd4d2fbf518e9aeb37636a6484c8aa0a010110d2f70d9fd35c886e43f9c` |

For a revised edition, generate HTML and PDF from the same manuscript. Check equation numbering, references, tables and mathematical scope against that source. Bind the guide to the same edition, check its accessible text and controls, and publish a manifest of the selected files. Obtain the new version DOI through the actual deposit and verify the archived PDF hash. A mirror of the earlier edition and a revised manuscript need separate citation identities. [Zenodo versioning](https://help.zenodo.org/docs/deposit/manage-versions/)

## Implementation order

1. **Review the three-page reading path.** Read it on a phone and on paper. A reader should be able to reproduce the first two integer steps, explain when the stored value changes and find the paper without following an identifier to another service.
2. **Finish one paper edition.** Use Twist Numbers to prove the path from source to HTML, PDF, guide, citation and verified mirror. Supply a persistent per-paper URL before adding the next titles.
3. **Move the reading path to the existing front door.** Bring over the live metadata, verifier and machine-readable card. Reconcile the open [metadata draft](https://github.com/mathorn1973/twistjdotcom/pull/18). Check the Manifest redirect, deep links, shared application states and source fallbacks. Preserve the previous deployed revision as the rollback point.
4. **Refresh the rest in small groups.** Review Logos against its cited edition, extend the question index and attach only relevant illustrations. Treat the Canon displays, generated Logos and applications as separate changes with their own validation. A production switch and any new deposit are separate release decisions.
