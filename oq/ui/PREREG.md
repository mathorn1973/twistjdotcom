# OQ-UI-20261027-A preregistration

Owner: A. M. Thorn / OQ-UI-20261027-A. Issue #16.
Scope: NON-CANONICAL website engineering. Source of truth: mathorn1973/twistjdotcom
`main` at 5032cdbb13077a90d21ecee0e000b6b04cc45b44. TWIST-J Canon v105
is not modified. Finite UI evidence is at most candidate-C. Performance stays H.

## Frozen integration scope

Add opt-in `Exact query (experimental)` to the existing OQ page without
changing its Statevector and Compressed default behavior, engine code,
optimizer, QASM interpreter, first-party layout or Mathematika prototype.
The UI accepts one computational-basis amplitude, a joint masked Born event,
or a physical Pauli expectation (ring8 restricted active-space only). Method
choice: Auto, Direct phase counts, Affine phase, Active-space phase. Unsupported
combinations must refuse with a specific message; never silently substitute
physical amplitudes from a global-phase-discarding frame.

Parse QASM in a SAME-ORIGIN dedicated Web Worker. All exact arithmetic,
Clifford planning and model counting run inside that worker. No synchronous
model count on the UI thread; no `eval`, new Function, network-to-third-party,
new dependencies or service workers. Data travels by typed structured clone,
including BigInt; every result is one exact whole answer, no partial readout.
The worker is fresh for each run, checks a schema/id, and loads the fixed
sibling files `qasm.js`, `oqcount.js`, `oqrank.js`, `oqaffine.js`,
`oqhybrid.js`, `oqactive.js`. Stop calls Worker.terminate(), clears the
pending request, prevents stale results and resets the main UI. A hard
wall-time limit also terminates the worker. Resource limits still apply.

UI should clearly label computational basis bit convention, outcome masks,
ring8/ring16 and active-only restrictions, no exact sampler and no physical
state fingerprint. Return exact numerator coefficients over the appropriate
cyclotomic basis and power-of-two denominator, not a float as science.
Huge integers may be shortened visually only with an explicit notice.
Defaults and code correctness are not selected after inspecting examples.

## Frozen acceptance

1. Worker exact answers match the native dense OQ on HTH amplitude and
   irrational Born probability, Bell probability/joint correlation,
   negative and global phases, and ring16 selected amplitude.
2. All four method choices route as stated: count, affine, active, auto.
   Active physical Pauli is a proper restricted expectation, not an amplitude;
   reject ring16 active and other unsupported cases. Zero and nonzero input
   and bit ordering must be exact.
3. Large structured query should not allocate a physical statevector or
   block main-thread events. One known difficult case must fire its explicit
   resource or wall limit rather than hang or print partial numbers.
4. Test `Stop` during a long-running operation; worker must be terminated,
   controls restored, no stale response may overwrite later results.
   Similarly test hard timeout, worker startup failure and malformed inputs.
5. Statevector and Compressed modes, presets and existing self-test wiring
   remain. All old OQ optimizer/QASM3/rank tests and count/affine/active exact
   suites pass unchanged. Any failure is reported; no moved acceptance bar.
6. Run actual browser over HTTP with same-origin local assets if available.
   Browser tests must exercise user interactions, not only Node worker mocks.
   A headless browser result does not imply real mobile testing.
7. Perform security/file diff check and verify no production HTML injection of
   unescaped user input, no automatic expensive query on page load, and no
   changes to other website working-tree material. Mark auto speed selection H.

## Boundaries and limits

Worker deadline: 30 seconds, terminated (not claimed as solver bound).
QASM source at most 262144 UTF-16 code units. Max qubits 4096; max gates
10000; max Hadamards 1024 for direct path; max active rank 12 by default;
max joint projector bits 5; max counted assignments 65536; max DPLL nodes
50000; max DPLL depth 256; max CNF variables 30000, clauses 100000;
max linear-work units 1000000; max phase terms 10000, phase factors 20000;
max active rotations 512; max query gates 20000; max rank proxy 2000000.
Hard maximum backend limits remain stricter where necessary. These are
engineering safety defaults, not statistical or scientific thresholds.

Dynamic measurements and reset, approximate synthesis, unsupported gate sets,
and general physical amplitudes via active frame are refused. An old method
can remain faster. No subexponential #SAT backend is implemented. UI does not
promise practical advantage and does not automatically replace the old OQ.

Freeze implementation and test sources in Git before acceptance execution.
The existing formal/public TWIST-J probe protocol is not invoked, as this is
website engineering. A two-architecture run is reproduction only. An
independent code review is separate and not falsely claimed.
