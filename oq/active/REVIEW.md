# Same-session adversarial review

NON-CANONICAL. This is NOT an independent-agent review or formal acceptance.
Author/reviewer session: OQ-ACTIVE-20261027-B. Final code/test pin:
2dff922a1d10a9dd07b2c717c34fcdc3fc49fba9.

Reviewed proof obligations and implementation boundaries:

1. Signed Pauli convention i^p X^x Z^z, including full multi-Y sign.
   Complete n<=3 rotation matrices checked on every input basis and k=0..7.
2. Negative-axis rotation includes global w^k. Scalar +/-I handled separately.
3. Active restriction uses B^T z, not an orthogonal-basis shortcut. Extra tests
   deliberately use nonorthogonal binary basis columns at ranks three and four.
4. Active input is zero after original computational input has been absorbed
   into the frame. Nonzero-input tests cover this convention.
5. Out-of-code X shifts produce zero only AFTER forming the entire physical
   observable/product. Bell and all-outcome joint-event checks retain correlations.
6. Original frame's lost global phase is not used for a physical amplitude.
   The physical API rejects amplitude requests; internal active amplitudes
   are tested only against the inherited fixed frame convention.
7. Exact disjoint-wire gate shortening uses a common live predecessor on all
   touched wires. Global phase is preserved; no approximation enters.
8. Shared query, phase-assignment, linear-work and reference-node limits do not
   restart for every projector term. External callback costs remain unbounded
   by this module and are explicitly reported as external calls.
9. OQRANK.create/run are replaced by throwing functions during new-module
   tests; no active coefficient vector is allocated by the production source.
10. No network, eval, child-process or filesystem operation is present in the
    production module; imports are static siblings. Browser-global smoke does
    not establish real browser/UI behavior or interruptible frame planning.

Initial main acceptance passed. The first expanded stress run did not finish
within its tool deadline and was stopped, with no scientific mismatch reported.
The full coverage was retained. Exact disjoint-wire cancellation was added,
then both complete suites passed on both architectures. No runtime comparison
or speedup is inferred from these execution events. See RUN.md for the pins.

Open: independent proof/code review, practical performance comparison, broader
rank planner, and browser Worker/UI integration. No existing engine or public
Canon status is changed by this review.
