# C-OQ-AFFINE-PHASE-N result

**NON-CANONICAL. Finite executed evidence: candidate-C. General acceleration: H.**
No TWIST-J Canon, source-engine or live-site change.

Implemented `oqaffine.js` and `oqhybrid.js` against the pinned newer Matematyka
OQ interface. Endpoint Gaussian elimination, phase-form rank quotient,
constant-fibre multiplication, exact reconstruction and reduced ordinary
#3SAT are present. The existing OQRANK is available through guarded probability
routing, including exact joint diagonal projectors. No external subexponential
algorithm or general quantum speedup is assumed or implemented.

Acceptance at implementation commit 462ee0c3fb956b0c07219f29278f16ac59640583:

| Exact check | Count |
|---|---:|
| Circuits | 116 |
| Amplitudes against dense integer OQ | 512 |
| Born events against dense integer OQ | 652 |
| Full phase histograms against independent path enumeration | 1164 |
| Affine dimensions against independent bit-array elimination | 1164 |
| Reduced CNF histograms | 108 |
| Original counting-module histograms | 54 |
| Forced rank joint-event queries | 80 |
| Auto/explicit hybrid queries | 1168 |
| Exhaustive tiny reduced-CNF checks | 24 |
| Rejection/resource/cancellation guards | 42 |
| Deliberately structured wide/deep cases | 4 |
| Parser programs on the newer target | 4 |
| Browser-global export smoke, not real UI | 1 |

All passed on aarch64 and x86_64 with Node v22.22.2. Exact stdout is 776 bytes,
SHA-256 d1cc4168a616301f5711b70aebddfb8f0863302ea27615676d1a8e4b84e06bd4.
Both stderr streams are empty. This is cross-architecture REPRODUCTION of
one frozen test, not blind independent-agent confirmation or formal acceptance.

Structured H layers on 128 and 4096 qubits reduce a specified amplitude to
zero free endpoint bits and one phase evaluation. A one-bit event on the
4096 layer has d=4095 but chi=0, so one phase value carries multiplicity
2^4095. These circuits were already easy by other methods; this demonstrates
correct reduction and absence of a dense vector, not general large-qubit speed.

The (H T)^32 one-qubit probability has paired-phase rank chi=62 in this
representation while the existing active rank is r=1. Auto routing selects
the rank engine and agrees with dense exact arithmetic. This is a useful
counterexample to treating the affine method as a universal replacement.

All unchanged predecessor count, optimizer, QASM3 and rank suites passed on
aarch64; exact summaries and output hashes are in regressions-aarch64.json.
The predecessor source and frozen evidence were not edited.

## Remaining limitations

No wall-clock benchmark, calibrated crossover, optimal routing, tensor
contraction, subexponential solver, exact sampler, dynamic circuits, arbitrary
input vector, browser UI integration or live deployment. Rank planning is
limited by the existing engine and is not cancellable inside one call.
The internal active vector is not itself compiled into an affine query.
Correctness for an external counting callback remains conditional on its counts.
Full independent review of the candidate proof and implementation is outstanding.
