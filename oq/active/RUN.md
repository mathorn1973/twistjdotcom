# Execution and custody record

Owner: A. M. Thorn / OQ-ACTIVE-20261027-B. NON-CANONICAL engineering evidence.

Base: 3525794cbd08cb8d718a47946189ef1a0b646928.
Preregistration: 76938fe9046c44d95f4ab4bac93109309a5921c2.
Preregistration SHA-256:
31c5f8cf78ac7d4b911684bd57b912f3f4b31eef51311a27fee77105fd86c164.

## Attempts, no hidden acceptance or threshold change

1. a3c6ccdfcdfde9c853b14587f1cbe6cf4e15b2b5: main implementation and
   acceptance were pushed before execution. The target main suite passed.
2. 3854951656b83201e36affabbae71f95310cb409: added full-rank/nonorthogonal
   adversarial coverage and captured the reference allocator before installing
   the allocation-denial hook, so direct Node tests also work when sharing
   a module object. This was a test isolation correction, not a scientific
   mismatch. The full runner passed its main part but exceeded the 110-second
   tool deadline during stress. The remaining owned subprocesses were explicitly
   terminated. This attempt is INCOMPLETE, never counted as a full PASS.
3. 2dff922a1d10a9dd07b2c717c34fcdc3fc49fba9: exact disjoint-wire basis
   cancellation added to the production compiler. No tests, thresholds or
   coverage were reduced. Both complete suites passed on aarch64 and x86_64.
   The final wrapper uses a bounded process group and terminates all children
   on timeout rather than leaving a child after a tool timeout.

The event sequence is not a controlled timing benchmark and establishes no
runtime superiority or general speedup.

## Final reproduction

Command: `PYTHONDONTWRITEBYTECODE=1 python3 oq/test-active-matematyka.py`.
Runtime: Linux, Node v22.22.2, Python 3; architectures aarch64 and x86_64.
Each runner checked out the exact final code/test pin through Git. The target
runner reconstructs and verifies the five newer Matematyka source hashes.

Both exit codes: 0. Both stderr lengths: 0 bytes.
Both stdout lengths: 1431 bytes.
Both stdout SHA-256:
5906ce19b6f5b7d68837666988ed746bdd37eaa0a063f0051ae5cae8a3a7d5e0.
Empty stderr SHA-256:
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.

EXPECTED.txt is the actual complete target stdout. Neutral architecture
records carry hashes of all four final source/test files. The x86 record was
published as Git blob 25609d7dee172e5862b64e5d72fb8bfa2b959114 through the
write-authorized connector, then fetched by Git blob ID and verified before
commit. Git alone carries the shared evidence. No local machine path or
private log is part of the public record.

Cross-architecture reproduction does not imply blind independent-agent review,
a theorem-grade acceptance or a TWIST-J formal computation gate. Subsequent
commits change only documentation, neutral evidence and its hash manifest.
