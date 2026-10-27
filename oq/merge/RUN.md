# Integration execution record

Author: A. M. Thorn. Session owner: OQ-MERGE-20261027-C.
Integration code/test pin: `51c2433ef1c2cb2509ee17f30f5f5195ed3a17c9`.
Earlier draft pin `0bbb512525f034c0201ba72033a67a3488a8ffbe` contained
an error in the TEST fixture: ring16 amplitudes are eight-element arrays,
and ECR's ring16 reference must be converted to the even-coefficient ring8
subfield before comparison. This was not a production parser failure.
The fixture was corrected in a NEW commit; no gate assertion or threshold was
removed. The final exact test and all regressions passed on the corrected pin.

Source code from the newer Matematyka prototype was re-hashed after validation
and was unchanged from SOURCE.md. The website repository's unrelated local
modified working tree was never touched: isolated Git clone used throughout.

## Exact output ledger, x86_64

Commands were executed in the isolated checkout with Node v22.23.4:

| Command after `node` or `python3` | exit | stdout bytes | stdout SHA-256 | stderr bytes |
|---|---:|---:|---|---:|
| `node oq/test-matematyka-gates.js` | 0 | 110 | `22bd9ca152482c8c40e77792ecf3530f25dbe60868d08e85f0f44c925b4a2625` | 0 |
| `node oq/test-optimizer.js` | 0 | see local transcript | `5a443b33fa1f7cd8f52ccb1a60312976469a48c657c98ce2479f81dd9ac1bbbe` | 0 |
| `node oq/test-qasm3.js` | 0 | see local transcript | `dffe2da03806b3ef7411116510de72855aa60c921fa643b35e8d2576a4a638e5` | 0 |
| `node oq/test-rank.js` | 0 | see local transcript | `58fe968c0cfcf318a44f8e8df18716d65300c21d498c3995a8f18a3bcdd238c3` | 0 |
| `node oq/test-count.js` | 0 | see local transcript | `16d488f561dfbdb2782b6f5dcb8d9bcb1fbd557ca56f98966692317a35d5d63f` | 0 |
| `OQ_REQUIRE_MATEMATYKA=1 node oq/test-affine.js` | 0 | see local transcript | `5522c534cebe402ae420d59015f6de48089294fd2efd9966e913324f716fb3e8` | 0 |
| `OQ_REQUIRE_MATEMATYKA=1 node oq/test-active.js` | 0 | see local transcript | `3aab7a5e252a0c82c17d4f0f93b4a0e1754fbb07bca965a0e5f44e74680fdb1b` | 0 |
| `node oq/test-active-stress.js` | 0 | see local transcript | `13c608dbdd842065acb4b2fee40912cb842c99ef59045a8fc728fd78fc082522` | 0 |
| `python3 oq/test-count-matematyka.py` | 0 | 774 | `887b27b4b260fbbfdbee6660b6f176919a13922e3429d563b0b5532266659644` | 0 |
| `python3 oq/test-affine-matematyka.py` | 0 | 776 | `d1cc4168a616301f5711b70aebddfb8f0863302ea27615676d1a8e4b84e06bd4` | 0 |
| `python3 oq/test-active-matematyka.py` | 0 | 1431 | `5906ce19b6f5b7d68837666988ed746bdd37eaa0a063f0051ae5cae8a3a7d5e0` | 0 |

Only the small new gate-suite output is committed as EXPECTED.txt; inherited
suites already carry their frozen expected evidence. Logs of existing tests
remain separate and are not copied into the public repo. Their hashes here
are engineering audit metadata, not independent theorem certification.

## aarch64 reproduction

An independent Git checkout of the exact test/source commit
`51c2433ef1c2cb2509ee17f30f5f5195ed3a17c9` was used with Node v22.22.2.
The newer parser's normalized SHA-256 was
`8336152fa2662d33e619020e2eb3d3c72c75ac3c564450292cd4fc67188fc56c`.
The parser-gate test, original optimizer/QASM3/rank tests and count/affine/
active/adversarial suites all exited successfully, with the same scientific
DIGEST lines and counts as the corresponding x86_64 target runs. For affine
and active the `OQ_REQUIRE_MATEMATYKA=1` mode was explicitly set.

No blind independent-agent review, formal Lean proof or measured speedup is
claimed. The existing publication system has no GitHub Actions checks for
these PRs, so review was done by pinned source readback and direct tests.
