# Merge result: newer Matematyka OQ parser with optional counting stack

**NON-CANONICAL engineering. Source integration and finite exact tests PASS.**
General/practical acceleration stays H. No theorem, TWIST-J Canon change,
independent-agent review or automatic adoption of a new simulation backend.

Integration branch: `integration/matematyka-oq-20261027`, based on the
three existing stacked experimental PRs #9 (count), #11 (affine), #13 (active).
It imports **only** the newer normalized `qasm.js` and `QASM3.md` from
Matematyka's prototype. Six original engine files were already identical
across the two website copies after CRLF normalization. The source is frozen
by SHA-256 in SOURCE.md. Stand-alone and site-local index.html files are
not replaced.

## Gate and syntax acceptance

A new exact test checks the documented `iswap`, `dcx`, `csx`, `csxdg`,
`c3x`, `c4x`, `ecr`, `rzx`, `r`, brace-set QASM3 loops, `box`, `delay` and
`pragma` behavior. It compares all small basis states and every cyclotomic
coefficient, including global phase. The ECR reference uses separately
composed RZX gates; since that route uses Q(zeta16), the test first proves
its output lies in the embedded Q(zeta8) and compares exact even coefficients.
These are scoped declared-gate tests, not complete OpenQASM3 certification.

Fractal x86_64 and independent aarch64 execution: **PASS** with identical
parser-test digest `a44599cd7ccc4670aea09bd9dd444f9ad8c434d0e9f0434a810ea5cdfd172c84`.
The x86_64 test stdout has 110 bytes, SHA-256
`22bd9ca152482c8c40e77792ecf3530f25dbe60868d08e85f0f44c925b4a2625`.
Both report 16 optimized/unoptimized gate scenarios, 184 basis checks,
11,968 exact coefficient comparisons, 96 controlled-X cases and 4 syntax checks.

## Existing regression inventory (Fractal x86_64)

| Suite | PASS summary |
|---|---|
| Optimizer | 219 cases, 1,624 full-state comparisons |
| QASM3 | 63 programs, 1,326 exact trajectories |
| Compressed rank | 140 circuits, 3,456 Pauli expectations |
| Count direct (imported parser) | 109 circuits, 464 amplitudes, 436 probabilities, 900 phase histograms |
| Affine direct (imported parser) | 116 circuits, 512 amplitudes, 652 Born events, 1,164 phase histograms |
| Active direct (imported parser) | 9,344 rotation-basis cases, 69,888 matrix entries, 2,312 expectations, 200 events |
| Active stress | four rank-3/4 circuits, 1,280 expectations, 48 joint events |
| Count pinned reconstruction | PASS, expected digest preserved |
| Affine pinned reconstruction | PASS, expected digest preserved |
| Active pinned reconstruction | PASS, expected digest preserved |

The new parser test and the original optimizer/QASM3/rank suites also passed
on aarch64. The direct count, affine, active and adversarial active suites
were run on aarch64 with the SAME newer parser SHA-256, and matched the
x86_64 scientific digests exactly. See RUN.md for commands and stdout hashes.
This is cross-architecture reproduction, not blind independent verification.

## Live publishing boundary

The source is currently a local working prototype under a directory excluded
from Matematyka deployment. On the audit date, both
`https://matematyka.cz/oq/` and the prototype OQ path returned HTTP 404.
Merging the website repo may update `twistj.com/oq/` through its existing
publishing mechanism, but does NOT deploy the Matematyka prototype. Do not
claim it is live there. No stand-alone OQ UI feature is automatically enabled;
advanced modules remain optional and may block a UI thread without Worker
isolation. Existing default statevector/low-rank paths remain unchanged.

## Remaining boundaries

No practical speedup benchmark, subexponential counter, exact general
sampling, dynamic-circuit path-counting, ring16 active compiler, runtime backend
auto-switch by measured cost, browser UI integration or independent code review.
The original mathematical H claims remain H. Refusing a too-large exact count
is a correct resource outcome, not an approximate answer.
