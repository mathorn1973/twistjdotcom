# Affine reduction and guarded exact query routing

**C-OQ-AFFINE-PHASE-N. NON-CANONICAL. General acceleration remains H.**

`oqaffine.js` eliminates affine endpoint constraints and counts only the
remaining phase dependence. `oqhybrid.js` selects that route, its reduced
ordinary #3SAT representation, or the existing Clifford-frame rank engine
for compatible probabilities. No existing source, browser UI or deployment
is changed. The parent counting module and its frozen evidence remain intact.

This targets the newer Matematyka OQ interface pinned by
`counting/SOURCE.json` and `counting/matematyka-qasm.patch`. It does not use
the historical C implementation. A live deployment is not asserted.

## Use

Load `oqcount.js`, `oqrank.js` (optional rank route), `oqaffine.js`, then
`oqhybrid.js` for browser globals. Node uses static CommonJS imports.
Run synchronous work in a Worker before integrating into a browser UI.

```javascript
const QASM = require('./qasm.js');
const AFFINE = require('./oqaffine.js');
const HYBRID = require('./oqhybrid.js');
const program = QASM.parse(
  'OPENQASM 3.0; qubit q; h q; t q; h q;',
  { optimize: false }
);

const query = AFFINE.amplitude(program, 0n);
console.log(query.stats);
const amplitude = AFFINE.solve(query);
// amplitude.value = (1 + zeta_8) / 2, as exact integer coefficients.

const probability = HYBRID.solve(program, {
  kind: 'probability', mask: 1n, value: 0n
}, { backend: 'auto' });
// probability.value = (2 + sqrt(2)) / 4, exactly.
console.log(probability.stats.backend);
```

`AFFINE.probability(program, mask, value, options)` prepares a joint diagonal
Born event. It is not a product of marginal probabilities. `options.input`
selects any computational-basis input, default zero. Physical q0 is the least
significant bit. Input words and masks may be BigInt; unsafe Number values
are rejected. Inputs must be ordinary ring8/ring16 lowered static unitary
programs, not global-phase-discarding compressed programs or approximate
synthesis. Intermediate measurements, resets and feedback are rejected.
Terminal measurement metadata does not alter the requested premeasurement state.

`HYBRID.plan(program, request, options)` returns the chosen route and its
separate structural metrics without allocating the compressed state or
executing an exponential phase sum. Planning itself has polynomial work and
can reach a resource limit. `HYBRID.solve` plans and executes using the same
options. Choices are `auto`, `affine`, `cnf`, `rank`. A forced unavailable
route fails explicitly. Amplitudes never use the rank route.

### Reduced counting backend

```javascript
const COUNT = require('./oqcount.js');
const compiled = AFFINE.toCNF(query);
const dimacs = COUNT.dimacs(compiled.query, 0);
console.log(compiled.stats); // independent bits AND auxiliary variables

const answer = AFFINE.solve(query, {
  backend: 'cnf',
  maxNodes: 250000,
  counter(cnf, context) {
    // Supply an exact nonnegative BigInt count for ALL declared variables.
    return COUNT.countCNF(cnf, { maxNodes: 250000 });
  }
});
```

`compiled.query` counts reduced phase coordinates; its counts must be
multiplied by `compiled.multiplicity`. Do NOT interpret
`COUNT.solve(compiled.query).value` as the original circuit output.
`AFFINE.solve` performs the multiplication and original normalization correctly.
An external counter is trusted for each exact count; the interface and total
cardinality check do not certify an arbitrary solver. No subexponential
counting algorithm is present.

## Three different ranks, never interchangeable

Write q for physical qubits, h for Hadamards and F(z)=b+A z for endpoints.

- rho is the rank of A. It removes endpoint constraints.
- chi is the rank of the affine linear forms actually occurring in the
  surviving factored phase expression, AFTER endpoint substitution.
- r is the existing OQRANK active-space rank. It describes another
  representation and is used only by the rank probability route.

For an amplitude, Gaussian elimination leaves d=h-rho independent bits.
For a masked probability it leaves d=2h-rho-rho_E, where rho_E is the rank
of the measured endpoint rows. The two histories have equal COMPLETE
endpoints. Inconsistent systems give zero immediately.

The phase then factors through chi independent linear forms. Every value of
those forms has exactly 2^(d-chi) preimages. Enumerate only 2^chi assignments
and multiply each phase count by that exact fibre size. Constant and
complementary factors and equal phase terms are simplified without expanding
parities into exponentially many monomials. chi is not claimed to be the
minimum functional dimension of the phase, nor small for arbitrary circuits.

Original normalization is retained: 2^(-h/2) for amplitudes, 2^(-h) for
probabilities. Neither d nor chi replaces h in this normalization.
`affine/PROOF.md` gives the candidate derivation and all scopes.

## What the hybrid does and does not combine

The rank route prepares the original Clifford frame and small active vector.
A masked event on m physical bits is read using

    P(E) = 2^(-m) sum_(S subset measured) (-1)^(value dot S) <Z_S>.

Thus joint readout uses 2^m existing Pauli expectations, not a product of
marginals. Its storage is still exponential in r. Basis inputs are prepared
with X gates. One-control phases and two-control CZ are adapted exactly;
other controlled phases and ring16 are not routed to OQRANK. Global phase
may be discarded ONLY in this probability route.

The affine route does not allocate a statevector. It preserves Clifford
efficiency by allowing the separate rank route to win, not by compiling the
internal active vector into an affine phase problem. That deeper composition,
a tensor-contraction backend, quantum sampling and dynamic circuits are NOT
implemented here. The module returns scalar queries, not a compressed
representation of the entire physical state.

Auto routing compares explicit structural work proxies and respects limits.
These proxies omit important bit-operation costs and are NOT calibrated
runtime guarantees. When direct enumeration is over budget and rank is not
available, the reduced CNF route is tried under its own limits. A resource
failure returns no partial scientific answer.

## Metrics and limits

Inspect `query.stats` or hybrid `result.stats`: physical qubits, gate count,
h, rho, rho_E, constraint rank, d, chi, phase multiplicity, phase terms and
factors, planned phase assignments and linear-work counter. Hybrid adds r,
projector terms, selected route and both work proxies. CNF output separately
reports total variables, auxiliary variables and clauses. Never report chi
as the #SAT variable count or as the physical qubit count.

Default limits:

| Resource | Default |
|---|---:|
| Qubits / Hadamards | 4096 / 4096 |
| Lowered gates | 100000 |
| Symbolic linear-work units | 20000000 |
| Surviving phase terms | 200000 |
| Processed phase factors / symbolic bits | 500000 / 64000000 |
| Enumerated reduced assignments | 1048576 |
| CNF variables / clauses | 200000 / 1000000 |
| Rank / coefficient bits | 16 / 4096 |
| Projector measured bits | 8 |
| Rank work proxy | 50000000 |

The existing counter additionally bounds DPLL nodes and depth. Options can
lower limits; each exposed limit also has a hard maximum. Counts and
coefficients are BigInt. These bounds and counters are not wall-clock
promises. Cancellation is checked at symbolic and enumeration operations,
and between rank steps/readouts. An individual existing rank operation or
plan is not cooperatively interruptible inside its implementation; Worker
isolation is required for responsive browser cancellation.

## Reproduction and status

From the repository root:

```sh
python3 oq/test-affine-matematyka.py
python3 oq/test-count-matematyka.py
node oq/test-optimizer.js
node oq/test-qasm3.js
node oq/test-rank.js
```

The first command reconstructs and checks all FIVE newer-interface hashes
before acceptance. `node oq/test-affine.js` alone instead uses the public-base
parser unless `OQ_ENGINE_DIR` is set; it is not a substitute for the target run.

The executed finite evidence is candidate-C. Identical aarch64/x86_64 output
is cross-architecture reproduction, NOT blind independent-agent confirmation,
formal Lean proof, a TWIST-J promotion or a general performance theorem.
See `affine/RESULT.md`, `affine/RUN.md` and `affine/SHA256SUMS`.
