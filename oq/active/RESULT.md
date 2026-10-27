# C-OQ-ACTIVE-PHASE-N result

NON-CANONICAL. Finite exact evidence: candidate-C. General/practical speedup: H.
No Canon promotion, existing engine change, browser integration or deployment.

Implemented direct composition in oqactive.js: inherited Clifford active-space
planning -> exact restricted Pauli circuit -> affine elimination/phase quotient
-> scalar expectation or joint Born event. Neither physical nor active statevector
is allocated by this path. This replaces the prior routing-only limitation
for the explicitly supported ring8 observable interface, not for all OQ tasks.

## Exact acceptance at 2dff922a1d10a9dd07b2c717c34fcdc3fc49fba9

Main suite: 9344 input-basis rotation checks, covering 69888 exact matrix
entries; 40 circuits; 84 internal active amplitudes; 2312 physical Pauli
expectations; 200 joint Born events; 16 reduced-CNF expectation checks;
12 full active-query phase histograms; 38 rejection/resource guards;
4 newer-parser programs; 3 structured wide/unfavorable cases; browser-global
export smoke. Forty circuit tests forbid calls to the active state allocator.

Additional adversarial suite: four rank-three/rank-four circuits with
nonorthogonal binary bases and both zero/nonzero input, 48 active amplitudes,
1280 signed physical Pauli expectations, all 48 joint full-register outcomes,
eight independent tiny exact-count callbacks, and ten additional guards.

Both suites pass on aarch64 AND x86_64 with Node v22.22.2. Full stdout is
byte-identical: 1431 bytes, SHA-256
5906ce19b6f5b7d68837666988ed746bdd37eaa0a063f0051ae5cae8a3a7d5e0.
Both exit codes are zero and both stderr streams empty. This is reproduction,
not independent-agent confirmation, Lean verification or a Canon gate.

Unchanged predecessor count, affine, optimizer, QASM3 and rank suites pass
on aarch64, with exact output hashes in regressions-aarch64.json. The new
module has no scientific dependency on an external claimed ETH result.

## Positive and negative engineering witnesses

A structured 4096-qubit Clifford graph input has 8192 original H gates but
active rank one and only two H gates in its compiled active circuit. A
specified correlated Pauli expectation has chi=2 and needs four reduced phase
evaluations; it equals sqrt(2)/2 exactly. The tested two-bit zero event is
1/4. The 128-qubit instance gives the same scoped readouts. These graph
circuits were already tractable by the original rank method, so this is an
exact-composition and memory-avoidance witness, not a superiority claim.

For one-qubit (HT)^32, active rank is one but the tested active phase query
has chi=62 and 2^62 planned assignments. The small enumeration and CNF budgets
reject it. The old active vector is much more appropriate. The new method
must not replace the old backend indiscriminately.

## Limits

Existing planner r<=20, q<=4096; ring8 only; restricted Clifford+T/CZ input;
no physical amplitude API. Joint events still cost up to 2^m projector terms.
No exact sampler, dynamic circuit, arbitrary dense input, ring16 rank bridge,
tensor contraction, calibrated auto-routing, browser UI or live deployment.
Independent proof/code review remains outstanding; REVIEW.md is same-session.
