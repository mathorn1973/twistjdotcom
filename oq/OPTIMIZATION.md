# Exact phase simplification in OQ

OQ already uses the integer coefficient representation behind the M algebra:
in `oq.js`, multiplication by sqrt(2) sends
`(c0,c1,c2,c3)` to `(c1-c3,c0+c2,c1+c3,c2-c0)`. The new `oqopt.js`
reduces the circuit before this arithmetic runs.

## What the compiler does

Within an X/CX/SWAP/phase block, each wire is an affine Boolean form
`f(x) = a.x XOR b`. CX is row addition over F2, SWAP exchanges rows, and X
changes the affine offset. A phase with exponent k contributes

```
k f(x) = k b + (-1)^b k (a.x)    modulo 8 or 16.
```

The optimizer adds coefficients of equal parity masks, including occurrences
on different wires after CX or SWAP. It keeps an occurrence in the original
circuit as the anchor and retains the constant term as a global phase.
All affine gates retain their order. Adjacent inverse H/X/CX/SWAP pairs also
cancel. H, controlled phases (AND rather than parity), measurements,
conditional blocks and unknown instructions terminate a block. Conditional
bodies are left untouched.

These are exact identities of the entire unitary, valid for every input
state. The rewrite retains global phase, so exact amplitudes, probabilities,
and the canonical state fingerprint are preserved in a common ring.

Examples:

- `H; T^512; H`: the existing `t-heavy`
  preset goes from 514 gates to zero. Its fingerprint stays `cf34b6408f73bf23`.
- `T q0; CX q0,q1; SWAP q0,q2; Tdg q2`: the two phases cancel across the
  affine gates, leaving CX and SWAP.
- `p(pi/8); p(pi/8)`: becomes `p(pi/4)`. A circuit containing no other
  finer phases can then use four coefficients per amplitude instead of eight.

## Integration and limits

`QASM.parse(source)` simplifies the lowered gate list before selecting the
coefficient ring and dense/sparse container. Both QASM 2 and QASM 3 use it.
`QASM.parse(source, { optimize: false })` retains the original gate sequence;
the browser's engine identity tests and throughput benchmark use this mode
so the compiler cannot remove the work being tested.

The program's `optimization` field reports input/output instruction and phase
counts. Counts refer to the optimizer stage; the parser can subsequently
remove deferred measurement instructions. The standalone API is
`OQOPT.optimize(gates, n, modulus)`, with modulus 8 or 16 (default 16).
It does not mutate its input.

The existing dynamic-circuit fallback may still discard off-lattice global
phases when only those phases would require the unsupported dynamic ring16
engine. That is a separate, explicitly warned parser operation, not an exact
optimizer rule. Combining such phases before that fallback may retain an
even global phase that the unoptimized fallback would have discarded.
Thus the raw/optimized fingerprint guarantee excludes that lossy fallback;
measurement probabilities remain the same.

This pass uses a bounded number of scans; it is not a search for a globally
minimal circuit or a general efficient simulator of Clifford+T circuits.
BigInt masks support registers wider than 32 qubits.

OQ now also offers a separate **Compressed — Pauli observables** mode in
`oqrank.js`, ported from the experimental rank-compressed representation.
It exposes selected Pauli expectations and single-qubit marginals, while
Statevector mode supplies full amplitudes, joint sampling, dynamic trajectories
and a canonical fingerprint. See [COMPRESSION.md](COMPRESSION.md) for the
algorithm, API, supported gates and limits.

## Verification

Run `node oq/test-optimizer.js` from the repository root. The deterministic
suite checks 192 random circuits in both rings on all basis inputs (up to
four qubits), targeted identities, global phases, QASM integration, dynamic
trajectories and 100-qubit sparse states. It compares every amplitude and
the canonical fingerprint rather than only measurement probabilities.

The run passed 1,624 full-state comparisons, 64 dynamic trajectories,
16 sparse comparisons and seven parser cases. This includes 16 trajectories
through the legacy lossy fallback, checked against a manually written exact
circuit as well as the original measurement probabilities. The browser Self-test passed
59/59 checks, including three optimizer checks, three compressed-observable
checks and the original engine suite.
