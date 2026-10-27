# C-OQ-ACTIVE-PHASE-N preregistration

Owner: A. M. Thorn / OQ-ACTIVE-20261027-B. Issue #12.
NON-CANONICAL engineering incubation. Performance H, finite evidence at most
candidate-C. NOT_APPLICABLE to physical L1-L6 layers. No Canon or deployment.
Base: 3525794cbd08cb8d718a47946189ef1a0b646928, predecessor PR #11.
Source: newer Matematyka engine/parser hashes and patch from counting/SOURCE.json.

## Frozen contract

Compose the existing ring8 OQRANK planner with OQAFFINE WITHOUT calling
OQRANK.create/run or allocating physical/active statevectors in the new module.
The planner still limits r<=20 and n<=4096; do not claim otherwise.

For each restricted Hermitian Pauli P=i^p X^d Z^z, construct a Clifford D
with D P D^dagger = sign Z_target (or sign I). Implement
R(P,k)=((1+w^k)I+(1-w^k)P)/2 exactly as D^dagger R(sign Z,k) D.
Handle multiple Y factors, negative axes, scalar +/-I, and every phase power.
Produce a compact active circuit on max(1,r) qubits from the rotations, with
at most polynomial gate overhead. Original frame global phase may be lost;
therefore expose physical probabilities/Pauli expectations, not amplitudes.

For a physical Pauli Q, pull back through the original frame. If its X mask
is outside the active binary span, expectation is zero. Otherwise restrict
it and use a further Clifford diagonalization to express expectation through
one affine-counted Born probability. Joint diagonal probabilities use all
2^m signed Pauli expectations, with explicit m and shared cumulative resource
budgets. Never multiply marginals or drop outside-span terms BEFORE forming
the Pauli products. Original computational-basis inputs are prepared by X.

## Acceptance and falsifiers, fixed before execution

All scientific equality is coefficientwise exact, no float tolerance.
Any mismatch is a failed attempt; retain and report it, fix on a new commit.
Tests and implementation must be pushed before their first acceptance run.

1. Complete small signed Pauli and rotation checks (all input basis states),
   including scalar axes, multi-Y factors, inverse and odd/even phase powers.
2. Deterministic small circuits and nonzero inputs: active circuit amplitudes
   against original OQRANK coefficient arithmetic (internal convention only);
   physical Pauli expectations and joint masked probabilities against direct
   dense OQ contraction, independent of the new diagonalizer.
3. Affine enumeration and reduced CNF produce equal exact scalars. Include
   frozen full phase-count comparisons where applicable.
4. Assert RANK.create/run are not called by the new module, including normal
   preparation, expectation, joint probability and wide structured examples.
5. Ring16, unsupported controlled phases, dynamic/approximate/compressed input,
   malformed Pauli/gates/masks, rank/gate/query/assignment/node limits and
   cancellation fail explicitly without returning partial results.
6. Newer Matematyka source readback and unchanged count/affine/optimizer/QASM3/
   rank suites. Browser export smoke is not a real browser/UI test.
7. Structured wide Clifford circuits with small active rank, and at least
   one unfavorable deep case. Record q,r,t,h_original,h_active,chi and total
   work. No general large-qubit or runtime superiority claim.
8. Reproduce exact acceptance stdout on aarch64 and x86_64 if available;
   same tests on another architecture are NOT blind independent review.

## Scope exclusions

No external ETH theorem is needed. No subexponential solver, physical amplitude,
ring16 rank compiler, arbitrary dense input, dynamic circuits, exact sampler,
tensor contraction, UI integration, deployment or general performance theorem.
No independent-agent acceptance is claimed unless actually obtained.
No existing source/test/preregistration files are edited by this lane.
