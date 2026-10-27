# C-OQ-AFFINE-PHASE-N preregistration

Owner: A. M. Thorn / OQ-AFFINE-20261027-A. Issue: #10.
Status: NON-CANONICAL engineering incubation. Performance remains H.
Scope: NOT_APPLICABLE to the TWIST-J L1-L6 physical carrier protocol.
No Canon modification, physical claim, deployment or replacement of a backend.

## Frozen source and contract

Base: mathorn1973/twistjdotcom@231e70d6d7c5b39bf75cad7da2c4468fa9be2cb1.
Use the newer Matematyka interface reconstructed by counting/SOURCE.json and
counting/matematyka-qasm.patch. No historical C repository or mutable website
copy substitutes for these bytes. The predecessor tests and evidence stay intact.

Inputs: static unitary lowered h/x/cx/swap/zpow/mcpow/gphase circuits with
R=8 or 16, computational-basis input, exact phases; terminal measurements
are metadata only. Reject dynamic/approximate/compressed inputs.

## Equations and method

One Boolean variable per H. Endpoints F(z)=b+A z over F2. Keep phase as a
sum of weighted products of affine Boolean forms modulo R; never expand
parities into an exponentially large integer polynomial.

Amplitude y: solve A z=y-b, leaving d=h-rho free bits.
Masked Born event: solve F(z)=F(z') on the COMPLETE endpoint and pin the
event there, leaving d=2h-rho-rho_E bits if consistent. Sum phase differences.
Inconsistent systems give zero. Each parametrization is bijective.

After substitution, simplify constant/duplicate/complementary factors and
combine identical terms modulo R. Let chi be the binary rank of all linear
forms occurring in the surviving phase factors. Sum over chi coordinates
and multiply each phase count by 2^(d-chi), the exact fibre size. This is
not a theorem that all phase functions or circuits have small chi.

Offer reduced enumeration and ordinary unweighted #3CNF using unique auxiliary
extensions. Reconstruct the original normalization, never renormalize a query
by d or chi. A rank-based route may serve ring8 probabilities using the
existing OQRANK and the projector expansion over Z strings, charging 2^m
observables for m measured bits. Never use it for phase-sensitive amplitudes.
Selection scores are declared structural proxies, not runtime guarantees.

## Frozen acceptance and falsifiers

Every executed case must agree EXACTLY in every integer coefficient and in
phase histograms when comparing counting methods. A single mismatch is a
failure, never hidden by a tolerance or by amplitude cancellation. Check:

1. Both rings, all supported gates, nonzero computational inputs, odd/even H,
   negative/global phases, zero/full/contradictory masks and correlated outputs.
2. Independent small history enumeration and independent GF2 rank checks
   against elimination, fibre cardinalities and returned histograms.
3. Reduced CNF counts against reduced enumeration, including zero-variable
   cases, explicit auxiliary overhead and DIMACS parsing.
4. Dense OQ/OQ16 exact amplitudes and Born events; original count module
   comparisons on a bounded subset, not required on deliberately wide examples.
5. Forced rank, forced affine, forced CNF and auto routes where supported;
   joint masked probabilities, unsupported route rejection and cancellation.
6. Structured wide H layers and a Clifford/low-active-rank example showing
   distinct q,h,r,rho,rho_E,d,chi; no general large-qubit speed claim.
7. Existing count, optimizer, QASM3 and rank regressions remain unchanged.
8. Malformed input/resource limits throw without returning partial results.
   Browser global-export smoke is not an actual browser/UI test.

Tests and implementation are committed before their first acceptance run.
Any implementation/fixture defect is recorded and corrected on a new commit;
this engineering lane is not a sealed public probe. Retain the frozen
preregistration and thresholds, and distinguish all attempts. No independent
agent review or theorem promotion is implied. Reproduction on another
architecture is reproduction, not blind independent confirmation.

## Limits and bit costs

Bound qubits, H variables, terms/factors, linear operations, reduced
assignments, CNF variables/clauses and rank/projector costs. Scientific
coefficients and phase counts use BigInt. Plans must refuse before prohibited
exponential allocations. Synchronous APIs require Worker isolation for UI use.
Do not add network/eval/process/filesystem behavior to the browser modules.
