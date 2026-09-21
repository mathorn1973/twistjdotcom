# Compressed Pauli observables

Choose **Compressed — Pauli observables** in OQ's Mode selector, or load the
`rank-100` preset. The default Statevector mode continues to provide complete
amplitudes, sampling and canonical state fingerprints.

The compressed mode returns exact single-qubit probabilities and expectations
of Pauli products. Select qubits with `0, 1, 5-7`; an empty selection means the
first eight (or all qubits of a smaller register). `all` is accepted for at most
64 qubits. Write Pauli products as `X0 Y1 Z7`, separated by semicolons. `I` is
the identity, and `-X0 Z1` negates a product. A qubit may appear only once in
each product. Qubit indices are zero-based.

Results are exact elements of Q(sqrt(2)), displayed as an integer expression
over a power of two. Decimal values are display approximations. Marginals do
not define the joint distribution: for a Bell pair, each P(q=1) is 1/2 while
the expectation of Z0 Z1 is 1. This mode does not sample bit strings, expand
physical-basis amplitudes or produce a state fingerprint. Global phase is
irrelevant to the returned quantities and is not retained.

## Algorithm

The state has the form `C V |a>`. C is a Clifford frame stored by the images
`C† X_q C` and `C† Z_q C`. The isometry V maps the r-bit index s to the
physical bit string B s, where columns of B are independent binary masks.
Only the 2^r coefficients of a are stored, each as four BigInt integers with
a common power-of-two denominator in Z[zeta_8]. The Clifford frame and
binary basis require additional polynomial storage.

For an odd phase power k, transport its Z axis through the frame:

```
P = C† Z_q C = i^p X^x Z^z
R = ((1 + zeta^k) I + (1 - zeta^k) P) / 2
```

Gaussian elimination finds the rank r of all transported x masks and their
coordinates x = B d. Restricted to the active space,

```
P V = V i^p X^d Z^(B^T z).
```

The active vector is updated exactly, preserving interference. To read a
Pauli product Q, transport `C† Q C` and contract with the active vector. An
X mask outside the span of B gives zero expectation. Single-qubit
probabilities follow from `P(q=1) = (1 - <Z_q>)/2`.

The number of scalar operations is approximately O(t 2^r), with O(2^r) per
requested observable, plus polynomial preprocessing. Integer bit lengths
also affect cost. The method is useful when r is small; it remains
exponential when r approaches n. The rank is a property of this
representation, not a guarantee that all easy circuits have small rank.

## Supported circuits and limits

- Input state: all qubits zero.
- Lowered gates: H, X, CX, SWAP, phases in multiples of pi/4, and CZ.
  S, S-dagger, T, T-dagger, Z and supported composite spellings reduce to these.
- General controlled phases and multi-controlled gates are rejected; this
  version does not synthesize them into Clifford+T. Choose Statevector for
  those circuits, or supply their supported decomposition.
- Terminal QASM measurements are accepted as readout metadata. Intermediate
  measurement, reset and classical feedback are rejected. Observables refer
  to the state before terminal measurements, not the dephased or collapsed state.
- Relative pi/8 phases are rejected unless exact simplification removes them.
  An off-lattice global phase alone is ignored, as all observables are invariant
  under it. Approximate synthesis is disabled in this mode.
- Browser limits: 4,096 qubits, active rank 16, 64 requested marginals and
  16 Pauli products. Coefficients are limited to 4,096 bits before
  normalization. These limits bound resources, not mathematical validity.
- Planning checks the rank before allocating the active vector. Stop yields
  between phase steps and readout operations; incomplete simulations do not
  expose a final readout.

`rank-100` has a deliberately small four-qubit non-Clifford core followed by
Clifford encoding across 100 qubits. Its active rank is four: 16 coefficient
tuples (64 integers), plus the frame and basis. It is a structured example,
not a claim to simulate arbitrary 100-qubit circuits efficiently.

## API and validation

`QASM.parse(source, {mode: 'compressed'})` bypasses physical-state size
limits and produces a ring8 gate list for OQRANK. Ordinary parsing retains
its existing dense/sparse limits. The backend validates its supported gates.

```javascript
const QASM = require('./qasm.js');
const OQRANK = require('./oqrank.js');
const program = QASM.parse(source, {mode: 'compressed'});
const state = OQRANK.run(program.gates, program.n, {maxRank: 16});
const value = state.expectation(OQRANK.parseObservable('X0 Y1', program.n));
console.log(OQRANK.toString(value));
```

`plan(gates,n,opts)` does not allocate amplitudes; `create(plan)` allocates
the active vector. `state.step()` performs one non-Clifford phase operation
and returns true, or false after completion. `state.done` and `state.tCount`
report progress. Expectations and marginals require completion;
`state.checkNorm()` can be used at any step. The API allows an explicit
maxRank up to 20; the browser keeps its limit at 16. Exact values have
`{numerator: [BigInt,BigInt,BigInt,BigInt], denominatorExp: Number}`.

Run from the repository root:

```
node oq/test-rank.js
node oq/test-optimizer.js
```

The rank suite checks 140 small circuits, including 120 deterministic random
ones, against an independent contraction of OQ's dense amplitudes: 3,456
Pauli expectations and 394 marginals match exactly. It also checks 142 norms,
100-qubit rank-four storage, signed Y products, nonorthogonal binary bases,
resource guards, incomplete-state readout and eight parser cases. The browser
Self-test passes 59 checks, including Bell correlations, an irrational Y
expectation and the 100-qubit preset. Existing optimizer regression tests
continue to pass.
