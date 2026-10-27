# OQ-MERGE-20261027-C: Mathematika parser and optional exact backends

Status: NON-CANONICAL engineering integration. New acceleration H, exact finite test candidate-C.
Owner: A. M. Thorn / OQ-MERGE-20261027-C. Issue #14.

Base: mathorn1973/twistjdotcom branch incubation/C-OQ-ACTIVE-PHASE-N
at 4025ec020694ae5144126970cde3acf858d4e666, itself stacked on
incubation/C-OQ-AFFINE-PHASE-N at 3525794... and C-OQ-PATHCOUNT-N at
231e70d.... Public main was cadcafb0e3dd1d4799f7f2db0dc1b8082cac1a72.

Source: Fractal's existing website workspace
`/mnt/c/j/matematyka/prototypes/kvantovy-kasar/oq` (October 27 snapshot).
The source has no Git repository in that directory. The screenshot/website is
not authority: pin normalized source bytes in Git, record SHA256, verify again
before merging. 6 engine files are byte-equal to the stand-alone OQ after
CRLF normalization. `qasm.js`, `QASM3.md` contain independent newer changes.
Preserve existing stand-alone index.html, localized prototype index and ALL
uncommitted changes in /mnt/c/j/twistjdotcom. Do not copy entire source tree.

Scope: import normalized newer parser and docs, prove exact semantics of added
gate declarations via all basis states and independent expected matrices or
separately composed gates; preserve QASM3's timing-annotation handling; keep
new count, affine and active modules optional without changing default backend.
No automatic loading in the site UI and no deployment of the Matematyka
prototype. No TWIST-J Canon or scientific status change.

Mandatory checks before integration merge:

- All existing `oq/test-optimizer.js`, `oq/test-qasm3.js`, `oq/test-rank.js`.
- All three stacked new count/affine/active Matematyka suites, with frozen
  source readback, no changed prerequisites.
- New independently authored parser-gate suite: iSWAP, DCX, CSX/CSXdg,
  ECR, c3x/c4x, r and rzx, set-valued for, ignored timing box/delay/pragma,
  all exact amplitudes including global phase. Any mismatch fails.
- Browser-global module smoke already in predecessor, and non-deployment
  claims verified by local deploy allowlist + public HTTP status.
- No source change beyond approved parser/docs/tests. Review diff and scan
  production JS for dangerous new privileged APIs. Byte-identical pre-existing
  engines; no restyling or links overwritten.
- Preserve performance H. No independent theorem acceptance claimed. If
  validation fails, stop, record blocker, do not merge.

Do not mark merge successful before GitHub reports actual merge commits and
readback of main including all 4 series changes. No automatic live
Matematyka site deployment is authorized by this integration.
