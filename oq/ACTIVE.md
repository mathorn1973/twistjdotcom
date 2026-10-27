# Direct active-space to affine-phase composition

**C-OQ-ACTIVE-PHASE-N. NON-CANONICAL. General acceleration remains H.**

`oqactive.js` composes the existing Clifford-frame planner with the affine
phase engine. Unlike `oqhybrid.js`, this is not just a choice between an
active statevector and a path sum: the planner's Pauli rotations are compiled
to a small active circuit and THAT circuit is counted by `oqaffine.js`.
No physical or active coefficient vector is allocated by the new module.

No existing OQ source, predecessor test or evidence, HTML page, workflow or
live deployment is changed. This is an optional engineering module for the
newer Matematyka interface pinned in counting/SOURCE.json. General efficiency
and practical crossover are not established. No external ETH result is used.

## Quick use

From the repository root:

```javascript
const ACTIVE = require('./oq/oqactive.js');

const program = {
  n: 1, ring: 8,
  gates: [['h', 0], ['zpow', 0, 1], ['h', 0]]
};
const prepared = ACTIVE.prepare(program);
const result = ACTIVE.probability(prepared, 1n, 0n, {backend: 'auto'});
console.log(result.value); // (2 + sqrt(2))/4, exact integer coefficients
console.log(result.stats);

const z = ACTIVE.expectation(prepared, 'Z0'); // sqrt(2)/2, exactly
```

`prepare` accepts ordinary static lowered ring8 OQ programs and an optional
computational-basis `input` word. Nonzero input is incorporated into the
Clifford frame before compression; the resulting active circuit starts at
zero. Terminal measurement metadata is allowed; queries refer to the state
before terminal measurement. The newer QASM parser can produce the input
using ordinary parsing with approximate synthesis disabled.

For browser globals load `oqcount.js`, `oqrank.js`, `oqaffine.js`, then
`oqactive.js`. Synchronous execution belongs in a Worker, not on the UI thread.
The opaque preparation is local to one module instance; do not JSON-clone or
structured-clone it to a Worker. Prepare inside that Worker instead.
The module is not loaded by the current page.

## APIs and mathematical output

- `prepare(program, options)` creates a Clifford-frame plan and an immutable
  `activeProgram`, but never calls `OQRANK.create` or `OQRANK.run`.
- `expectation(prepared, pauli, options)` returns an exact physical Pauli
  expectation. A Pauli can be text such as `-X0 Y1 Z7` or the object
  `{x: BigInt, z: BigInt, phase: integer}`, meaning `i^phase X^x Z^z`.
  It must be Hermitian.
- `probability(prepared, mask, value, options)` computes a joint physical
  Born event `(output & mask) === value`. Bits outside mask must be zero.
- `solve(program, request, options)` prepares and computes a request of kind
  `expectation` or `probability`. There is intentionally no physical amplitude
  request: the inherited frame discards physical global phase.
- `query(prepared, pauli, options)` returns either an exact constant or an
  affine probability query with sign s. For the latter,
  `<P> = s*(2*P_active(target=0)-1)`. Its counts describe the ACTIVE measurement
  circuit, not physical histories of the original gate list.
- `rotationCircuit(n, pauli, k)` is a small exact algebra utility implementing
  `((1+w^k)I+(1-w^k)P)/2` on n<=20 qubits. It retains the full phase of this
  local unitary. This is not a physical-amplitude API.

All scalar results are `{ring:8,numerator:[BigInt,BigInt,BigInt,BigInt],
denominatorExp:integer}` in the basis `1,w,w^2,w^3`, divided by a power of two.
The exposed active circuit uses an internal frame convention. Its amplitudes
are NOT the physical amplitudes of the original register.

## The direct bridge

The existing planner supplies `|psi> = exp(i theta) C V |a>`, with
`V|s>=|B s>`. Its active state is generated from zero by restricted rotations

    R(P,k) = ((1+w^k)I + (1-w^k)P)/2,
    P = i^p X^d Z^z.

For each P choose a Clifford D with `D P D^dagger = sign Z_target`.
Synthesize the exact active rotation as `D^dagger R(sign Z_target,k) D`.
The negative-axis case includes its necessary global `w^k` factor. Scalar
+I is identity; scalar -I is a global phase. Multiple Y factors are handled
using the FULL Pauli phase, not merely the parity of the support size.

Physical observables are pulled back by C. An X mask outside the active
binary span has zero expectation. A mask inside gives an exact active Pauli.
A second diagonalization reduces its expectation to one active Born query,
which is passed to the existing affine elimination/phase quotient/counting.

For a joint event on m physical bits, sum all 2^m signed Z-product
expectations and divide by 2^m. Form each COMPLETE product before testing
active-span membership; two individually out-of-span factors may have an
in-span product. This is not multiplication of single-bit marginals.

The active gate compiler removes exact H/H and CX/CX inverse pairs and
combines Z phases across gates on disjoint wires. A per-wire live stack
certifies the required commutation. Global phase is retained exactly.
No approximate or up-to-global-phase identity is used in this simplifier.

The candidate proof is in active/PROOF.md. It is not independently accepted
and does not promote a TWIST-J scientific status.

## Choosing a counting route and reporting its cost

`backend` is `auto`, `enumerate` or `cnf`. Auto chooses direct reduced
enumeration if the remaining cumulative assignment budget permits it;
otherwise it tries reduced ordinary #3SAT under its node budget. This does
not invoke the old rank statevector. Use the old OQHYBRID/OQRANK separately
when it has a better representation. The old hybrid default is unchanged.

The prepared statistics distinguish physical q, active r, original H,
active H, raw/shortened active gate count and non-Clifford rotation count.
Query statistics add endpoint/free dimensions and phase rank chi through the
underlying affine query. Results report cumulative queries, enumerated phase
assignments, reference-DPLL nodes, maximum compiled CNF variables/clauses,
and the count of external calls. CNF auxiliary variables are not hidden.

A caller-supplied `counter` has the predecessor's exact nonnegative-BigInt
contract. Its execution costs and correctness cannot be certified or bounded
by the adapter. External calls are counted but not mislabeled DPLL nodes.
No subexponential solver, runtime guarantee or favorable average case is
claimed. Integer bit lengths and symbolic bitset costs matter.

## Limits and supported input

The inherited planner still caps physical qubits at 4096 and active rank at
20. Removing its coefficient array DOES NOT remove that planner restriction.
The new default maxRank is 20 because planning does not allocate 2^r values.

Supported: H, X, CX, SWAP, integer pi/4 phases, global phase, one-control
phases and two-control CZ. Ordinary mask-form lowered gates are required.
Ring16, other nontrivial controlled phases, intermediate measurement, reset,
classical feedback, compressed input programs and approximate synthesis are
rejected. Use predecessor methods for their broader supported classes.

Defaults: 100000 input gates, 4096 non-Clifford rotations, 100000 raw active
or query gates, 256 projector queries (8 measured bits), 1048576 total phase
assignments, 250000 total reference-DPLL nodes and 20000000 total symbolic
linear-work units per top-level result. Limits are shared across all terms
of a joint event. The predecessor's additional symbolic/CNF bounds apply.
No partial result is returned when a limit or cancellation fires.

The inherited planner is not internally cooperatively interruptible. Its
input is bounded, and cancellation is checked before and after it. A Worker
is necessary for responsive browser cancellation, including during planning.

## Reproduction

```sh
python3 oq/test-active-matematyka.py
```

This checks the five pinned newer-interface source hashes, runs the main
suite and then the adversarial full-rank/nonorthogonal-basis suite. The exact
output is in active/EXPECTED.txt. Both aarch64 and x86_64 reproduce it byte
for byte. This is not blind independent-agent confirmation, a Lean proof,
a real browser test or a formal Canon two-architecture gate.

The existing count, affine, optimizer, QASM3 and rank tests remain unchanged
and pass separately. See active/RESULT.md, RUN.md, REVIEW.md and SHA256SUMS.

A structured 4096-qubit Clifford graph example has 8192 original H gates,
active rank one, two active H gates and a selected expectation requiring
four reduced phase evaluations. The graph was already tractable by the old
rank method. Conversely, one-qubit (HT)^32 has chi=62 in this active-count
representation: it is deliberately refused by a small budget while the old
rank vector is tiny. These examples delimit the method, not prove superiority.
