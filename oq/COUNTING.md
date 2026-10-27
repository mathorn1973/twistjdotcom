# Experimental exact phase counting

**C-OQ-PATHCOUNT-N. NON-CANONICAL. Acceleration status: H.**

`oqcount.js` is an opt-in companion to the current browser OQ gate interface.
It computes one requested amplitude or one masked Born probability without
allocating a physical-basis statevector. The included counter is a bounded,
exponential-time reference DPLL implementation. It is NOT an implementation
of a proposed subexponential SAT algorithm and carries no speedup claim.

No existing dense, sparse or compressed mode is changed. The module is not
loaded by `index.html`, and nothing has been deployed.

## Which OQ this targets

The target is the newer OQ copied into the Matematyka Kvantovy kasar
prototype, not the historical C repository. Its ring8, ring16, optimizer and
rank sources agree with public web commit
`cadcafb0e3dd1d4799f7f2db0dc1b8082cac1a72` **after explicit CRLF-to-LF
normalization**. The raw bytes differ. Its QASM parser also has substantive
additions: extra gate spellings, set-valued QASM3 loops and timing annotations.

`counting/SOURCE.json` pins the original and normalized hashes.
`counting/matematyka-qasm.patch` preserves the newer parser as a small delta
against the named Git commit. `test-count-matematyka.py` reconstructs it in a
temporary directory and checks every consumed normalized source hash before
running the tests. No mutable machine path is needed for reproduction.

The prototype README and website deploy allowlist exclude `prototypes/`.
A live OQ deployment on matematyka.cz was not established. This work must not
be described as an update to that live site. No original prototype file was
modified.

## Use

The module exports `OQCOUNT` in a browser and CommonJS in Node. It has no
package dependencies, network access, dynamic evaluation or external process
execution. A synchronous counter should run in a Worker, not on the UI thread.
The existing QASM parser retains its existing size limits; this module does
not bypass them or misuse the compressed mode, which can discard global phase.

```javascript
const QASM = require('./qasm.js');
const COUNT = require('./oqcount.js');
const p = QASM.parse(`
  OPENQASM 3.0;
  qubit q;
  h q; t q; h q;
`, {optimize: false}); // synthesis stays disabled

const query = COUNT.amplitude(p, 0n);
const answer = COUNT.solve(query, {maxNodes: 250000});
// answer.value: {ring: 8, numerator: [1n,1n,0n,0n], denominatorExp: 1}
// Exactly (1 + zeta_8) / 2.

const event = COUNT.probability(p, 1n, 0n);
const probability = COUNT.solve(event).value;
// {ring: 8, numerator: [2n,1n,0n,-1n], denominatorExp: 2}
// Exactly (2 + sqrt(2)) / 4, not a rounded decimal.
```

An input is a parsed ordinary OQ program with explicit `n`, `ring` (8 or 16)
and `gates`. Terminal measurements may remain in the parser's `measures`
metadata. The query concerns the state before terminal measurement.

Supported lowered gates are exactly:

```
['h', q]
['x', q]
['cx', control, target]
['swap', a, b]
['zpow', q, exponent]
['mcpow', controlMask, exponent]
['gphase', exponent]
```

Phase units are `2*pi/ring`, so ring8 and ring16 exponents must never be
mixed. Controlled-phase masks may be nonnegative safe integers or BigInt.
The zero control mask is a global phase, as in the existing engine.
All query bit strings use physical qubits with q0 least significant.
`options.input` selects another computational-basis input (default zero).
This is not an arbitrary dense-state input API.

`amplitude(program, output, options)` requires a full output word.
`probability(program, mask, value, options)` sums Born probabilities over all
endpoints satisfying `(endpoint & mask) === value`. Bits outside the mask
must be zero in `value`. The zero mask requests total probability.

Intermediate measurement, reset, classical feedback, approximate synthesis,
compressed programs and unknown operations are rejected explicitly. No such
operation is silently dropped. Existing OQ supports more cases than this
experimental module; users should retain the original engine for them.

## Candidate derivation, not a Canon promotion

Let R be 8 or 16, zeta = exp(2*pi*i/R), and let h count the Hadamards in the
lowered unitary circuit. At an H gate, introduce one free Boolean output b.
For input bit a, its matrix element is

```
H[b,a] = 2^(-1/2) * zeta^(R*a*b/2).
```

All other supported gates either update bits deterministically or add an
integer phase modulo R. For fixed computational input x and output y, let
N_r be the number of histories with endpoint y and phase r. Then

```
<y|U|x> = 2^(-h/2) * sum_(r=0)^(R-1) N_r * zeta^r.
```

Unlike expanding sqrt(2) into two phase choices at every H, this introduces
only **one free history bit per H**, not two. The common sqrt(2) factor is
reconstructed once. With d=R/2, first form coefficients N_r-N_(r+d).
For even h, the denominator is 2^(h/2). For odd h, multiply the numerator by
`sqrt(2) = zeta^(R/8) + zeta^(-R/8)` and use denominator 2^((h+1)/2).
Normalize by removing common factors of two. Zero has denominator exponent 0.

A probability needs interference, not a count of paths alone. Introduce two
histories with the same input and require equality of their **entire** output
words, not just the measured bits. Impose the event on that common word and
subtract the two phases. If M_r counts those ordered pairs, then

```
P(event) = 2^(-h) * sum_(r=0)^(R-1) M_r * zeta^r.
```

The H sign is its own conjugate modulo R. The common global phase cancels
between the two histories. This yields one event probability without first
listing all final amplitudes. There are 2h free history bits for this query.

### Why these are ordinary #3SAT instances

X and SWAP can act directly on Boolean literals. CX uses an XOR relation;
control conjunctions and the fixed-width phase accumulator use AND and XOR.
Each auxiliary bit is constrained by a complete equivalence. For example,
`v = a AND b` is encoded by

```
(not v OR a) AND (not v OR b) AND (v OR not a OR not b).
```

Every auxiliary is a deterministic function of earlier bits. Inductively,
each choice of free history bits has exactly one auxiliary extension.
Endpoint and phase pins only filter these extensions. Thus the count is an
ordinary **unweighted, unprojected** model count. Clauses have width at most
three. Declared but unconstrained variables still count and may not be lost.

For fixed R, the Boolean size is linear in qubits, gate count and the total
number of control incidences, with explicit constant factors from the phase
accumulator. It is NOT a bound solely in the number of qubits. A deep circuit
can produce many more SAT variables than qubits.

These arguments explain the intended contract. The current acceptance is
finite engineering evidence (candidate-C); no independent theorem review or
formal Lean proof is claimed.

## Plugging in a counting backend

```javascript
const query = COUNT.amplitude(p, 0n);
const firstCNF = COUNT.phaseQuery(query, 0);
const firstDIMACS = COUNT.dimacs(query, 0);

const result = COUNT.solve(query, {
  counter(cnf, context) {
    // Return the exact number of satisfying assignments to ALL cnf.nVars.
    // Implement transport to a trusted counter outside this module.
    // Number, Promise, projected counts and weighted counts are not accepted.
    return COUNT.countCNF(cnf, {maxNodes: 250000});
  }
});
```

There are R calls (8 or 16). A backend must return a nonnegative BigInt for
each. Correctness with an external callback is conditional on its exact model
counts; this interface does not certify an arbitrary external solver.
`reconstruct(query, counts)` also accepts counts obtained separately.
The compiler exports enough information to test a future faster solver
without changing the algebraic frontend.

## Limits and cancellation

Default compilation guards: 4,096 qubits, 100,000 lowered gates, 200,000
variables and 1,000,000 generated clauses. Phase queries add at most four
unit/empty clauses. These are resource limits, not an efficiency theorem.
BigInt masks are required beyond the safe Number range.

Default reference solve guards: 250,000 DPLL nodes shared across all phases
and depth 512. `maxNodes`, `maxDepth`, `signal` and `shouldStop` may be supplied.
A limit or cancellation throws `OQCountLimitError`; no partial histogram is
returned as a final amplitude or probability. A node budget is not a wall-
clock guarantee. Browser cancellation needs Worker isolation or a cooperative
`shouldStop`; a blocked main thread cannot process a new abort event.

The reference solver uses depth-first search with no exponential memo table.
Its data structures have polynomial size in the compiled CNF, but its time
can be exponential. Existing dense, sparse and low-rank methods may be much
faster. There is no automatic backend selection and no performance comparison
claim in this module.

## Tests

From the repository root, with Git, Python 3 and Node supporting BigInt:

```
python3 oq/test-count-matematyka.py
node oq/test-count.js
node oq/test-optimizer.js
node oq/test-qasm3.js
node oq/test-rank.js
```

The first command is the target-interface test. It rebuilds the newer parser
from the Git pin and patch in a temporary directory, verifies hashes, then
runs the exact suite. The second tests compatibility with the public-base
parser too; it is not substituted for the newer target.

Three calculation routes are compared: CNF model counts, separate tiny path
and paired-path enumeration, and exact dense ring arithmetic. This is not
blind independent-agent confirmation. Tests include phase histograms so an
incorrect multiplicity cannot hide behind amplitude cancellation.

See `counting/RESULT.md`, `counting/RUN.md` and the committed output for the
executed finite scope. Wide-register examples are deliberately simple Bell-
style circuits, not evidence for efficient arbitrary 4,096-qubit simulation.

## What remains H or unimplemented

No subexponential solver is present. No practical crossover, average-case
advantage or effective reduction of treewidth is established. A future
counting method must be checked against the same exact histograms, its bit
costs and all auxiliary variables must be charged, and only measured workloads
can justify replacing an existing backend. Streaming exact sampling, dynamic
circuits, general overlaps and browser UI integration remain separate work.
