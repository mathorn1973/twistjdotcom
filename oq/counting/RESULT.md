# C-OQ-PATHCOUNT-N result

Status: NON-CANONICAL; candidate-C finite engineering evidence.
Acceleration remains H. No independent theorem acceptance or Canon promotion.

## Delivered

An opt-in JavaScript BigInt compiler for one exact amplitude or one masked
Born probability over the current OQ ring8/ring16 gate interface. It exports
8 or 16 ordinary unweighted 3-CNF counting queries, reconstructs the exact
cyclotomic answer, and supplies a bounded polynomial-space depth-first
reference counter. The reference counter can take exponential time.

The target was the newer Matematyka Kvantovy kasar OQ prototype. The newer
QASM parser is preserved reproducibly as a patch against a public Git pin;
all consumed source hashes are checked. Both direct prototype execution and
reconstruction passed with identical scientific digests. This does not
establish a live OQ deployment on matematyka.cz. No site files were changed.

## Executed finite scope

Newer target suite, implementation/test pin 5142a37:

| Check | Result |
| --- | --- |
| Circuits | 109 |
| Exact amplitude comparisons with existing dense engines | 464 PASS |
| Exact Born-event comparisons with dense coefficient contraction | 436 PASS |
| Phase histograms versus separate path/pair enumeration | 900 PASS |
| Tiny compiled CNFs, exhaustive assignment enumeration | 8 PASS |
| Generic counting cases, including free variables and counts above 2^53 | 54 PASS |
| Input, type, unsupported-operation, cancellation and budget guards | 27 PASS |
| QASM examples shared with public base | 3 PASS |
| Additional newer Matematyka parser examples | 6 PASS |
| Structured wide-register examples | 128 and 4096 qubits PASS |

Scientific digest:
`aaa8afcd2010b6f29d32af328d1fc7ea3f7bcb1db644b584099d5390f223e99e`.
The wide cases are simple structured examples. They do not establish useful
performance for general large quantum circuits.

Public-base compatibility suite also passed: 103 circuits, 436 amplitude
comparisons, 412 event comparisons and 848 histogram comparisons. It does not
replace the newer-target test.

Unchanged existing regressions all passed:

- Optimizer: 219 cases, 1624 full-state comparisons.
- QASM3: 63 programs, 1326 exact trajectory comparisons, 38 rejected inputs.
- Compressed/rank engine: 3456 expectations, 394 probabilities, 142 norms.

A Node vm smoke tested the browser-style global export and exact H-T-H
answers. No actual browser/UI integration test is claimed.

## Limits of acceptance

All runs used one x86_64 lane. Re-execution is reproduction, not blind
independent confirmation. No two-architecture gate or Lean proof was run.
No initial implementation execution failed and no scientific threshold was
relaxed. Source files remained unchanged throughout the checks.

The auxiliary uniqueness argument and the exact coefficient formulas are
written in COUNTING.md, but finite tests are not promoted to a universal
formal proof. External solver correctness remains an explicit interface
premise. The module rejects dynamic circuits and approximate synthesis.

## Remaining work

A practical or subexponential counting backend is NOT implemented. Its
integration and performance must be evaluated separately, charging the full
CNF size, bit lengths and all controls. Existing dense, sparse and low-rank
engines remain available and may be much faster. Browser UI integration,
cooperative/Worker scheduling, exact sampling and dynamic circuits are not
part of this change. No automatic backend switch or production deployment.
