# C-OQ-PATHCOUNT-N preregistration

Owner: A. M. Thorn / OQ-PATHCOUNT-20261027-A.
Status: NON-CANONICAL engineering incubation. Acceleration remains H.
Date: 2026-10-27. Claim: twistjdotcom issue #8.
No TWIST-J Canon authority, promotion, physical interpretation or deployment.

## Frozen scope

Add an opt-in module consuming the current Matematyka OQ lowered gates:
h, x, cx, swap, zpow, mcpow and gphase; rings Z[zeta_8] and Z[zeta_16].
The target is the Matematyka Kvantovy kasar prototype, NOT the old C engine.
That prototype is excluded by its deploy allowlist. Live OQ publication on
matematyka.cz has not been established and must not be claimed.

Base public source: cadcafb0e3dd1d4799f7f2db0dc1b8082cac1a72.
Engine sources match the prototype after explicit CRLF -> LF normalization;
the raw files are NOT byte-identical. The newer prototype QASM parser is
preserved as a patch against that base. SOURCE.json records both raw and
normalized hashes. No existing working copy or production file is edited.

## Objects and proposed reduction

For a circuit with h Hadamards, a computational basis input and one output,
count histories by phase r modulo R (R = 8 or 16). Each Hadamard introduces
one binary output choice. Its common 1/sqrt(2) factor is reconstructed
outside the Boolean count, rather than adding another binary branch.

A_yx = 2^(-h/2) sum_r N_r zeta_R^r.

For a masked Born event, use two histories with the same full endpoint,
constrain the requested endpoint bits, and subtract their phases:

P(event) = 2^(-h) sum_r M_r zeta_R^r.

Compile all auxiliary Boolean gates with equivalences, not one-way
implications. Every allowed history must have exactly one auxiliary
extension. Export ordinary unweighted 3-CNF, not projected counting.
Keep every declared variable in the count, including absent free variables.
Exact reconstruction uses BigInt coefficients and power-of-two denominators.

## Validation and falsifiers frozen before execution

1. Compare individual amplitudes and masked probabilities with direct exact
   contractions of the existing ring8/ring16 dense engines, for basis inputs,
   named interference/entanglement circuits and fixed-seed small random circuits.
2. Independently enumerate tiny CNFs to check functional extension and counts.
3. Check Born normalization, cancellations, global phase and bit ordering.
4. Exercise newer Matematyka QASM spellings, QASM3 loops, terminal readout,
   and reject dynamic/reset/feedback, compressed inputs losing global phase,
   approximate synthesis and malformed inputs. Preserve exact phase units.
5. Exercise zero/free/unsatisfiable CNFs, resource limits, cancellation,
   strict BigInt counter results, and compile a wide sparse circuit without
   any 2^n allocation. No incomplete count may become a final answer.
6. Run existing optimizer, QASM3 and rank regression suites unchanged.

One exact mismatch fails that revision. Record a failed revision before any
repair. Do not weaken equality, move a threshold or call a failed run PASS.
Tests are finite engineering evidence, not independent theorem acceptance.
A second execution of the same tests is reproduction only. No cross-
architecture gate is claimed by this session.

## Explicit nonclaims

The reference DPLL counter can take exponential time. The recent proposed
subexponential algorithm is neither implemented nor assumed by correctness.
No measured speedup, 2^o(n)-in-qubits guarantee, full-state compression,
sampling algorithm, treewidth improvement or arbitrary-state input claim.
The relevant Boolean size includes gates, controls and all auxiliaries.
The module is not connected to the live UI and does not replace existing modes.
