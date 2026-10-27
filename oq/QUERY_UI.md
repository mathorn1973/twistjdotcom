# Exact scalar queries in the OQ browser

**NON-CANONICAL engineering integration. Practical acceleration: H.**

The normal Statevector and Compressed modes stay the defaults. The optional
`Exact query` mode adds only selected exact outputs, not a full quantum state.
It uses a dedicated same-origin Worker, `oqqueryworker.js`, for all parsing,
Clifford planning, exact arithmetic and model counting. `oqqueryui.js` is the
UI adapter; neither module is used by the existing default simulations.

## Using the controls

1. Choose **Exact query: one result, no full statevector (experimental)**
   from the Mode selector. This mode does not run on page load.
2. Enter OpenQASM as usual, then select a query:
   - **Born probability:** `measured qubits` such as `0,2` and `outcome
     bits` such as `10`. The first bit is q0=1, the second q2=0.
     Together they denote ONE joint event, never the product of marginals.
   - **Computational-basis amplitude:** a complete basis output such as `0`,
     `5` or `0b101` (qubit 0 is the least-significant bit).
   - **Physical Pauli expectation:** one Hermitian product such as `Z0`,
     `X0 Z1` or `-Y0 X1`. Ring8 active code only.
3. `input |x>` is the starting computational-basis state, decimal, 0b binary
   or 0x hexadecimal. It defaults to zero and cannot be an arbitrary vector.
4. Select a method:

| Method | Amplitude | Joint Born | Physical Pauli |
|---|---|---|---|
| Auto | affine / reduced counting | guarded old hybrid (may allocate a **small active** vector) | active-frame to affine query |
| Path counts | original full phase CNF | original paired path CNF | active-frame to reduced CNF |
| Affine paths | endpoint + phase-rank reduction, bounded enumeration | endpoint + phase-rank reduction, bounded enumeration | active-frame to bounded affine enumeration |
| Active space | refused: physical global phase unavailable | active-frame to affine/count | active-frame to affine/count |

The current Auto method uses structural estimates, not measured runtime
optimality. It may be worse than the original OQ; select a different route
or return to Statevector/Compressed. No new subexponential #SAT solver is
present. Counting is always exact but can be exponentially costly.

`Run` starts a fresh Worker. The `Stop` button terminates it immediately.
No partial phase histogram or incomplete answer is displayed. A 30-second
wall-time limit also ends a Worker without a result; this is a UI safety
limit, not a computational theorem or performance guarantee.

The displayed value is an exact polynomial in a primitive eighth or
sixteenth root of unity divided by a power of two. Integer coefficients
are `BigInt` in the Worker. Large coefficients may be shortened in the UI
with an explicit warning; such shortened text is not a full coefficient.
The mode produces no full-state fingerprint, shots or continuous physical
amplitude stream. Terminal QASM measurements are treated as readout
metadata; intermediate measurements and resets are rejected.

## Storage-independent parser mode

`QASM.parse(src, {mode:'exact-query', optimize:false})` retains all global
phase gates, all exact ring16 phases and all terminal measurement metadata.
Unlike Statevector and Compressed, it does not impose the 26/22-qubit
dense-state memory cap or estimate physical sparse support. It still caps
qubit indices at 4096, emits at most 10000 parsed gates and at most 10000
QASM3-expanded statements, and rejects dynamic operations. It does not
change parsing in either existing mode. The worker turns native QASM
`mcpow(maskOrNull,k,qubitList)` into a verified arbitrary-width BigInt mask,
so controls above qubit 31 do not vanish.

## Fixed browser budgets

The worker uses only fixed resource settings, not user-controlled timeouts.
Current defaults are 10000 gates, 1024 Hadamards (direct path), active rank
12, at most five measured bits, 65536 reduced phase assignments, 50000
reference-DPLL nodes, depth 256, 30000 CNF variables, 100000 clauses, and
symbolic/active work guards recorded in `ui/PREREG.md`.

Browser termination is the only effective way to interrupt a tight
synchronous solver operation. This is why the methods are NEVER called on the
UI thread. The Worker is not persistent and imports only same-directory
first-party modules; it performs no external network queries or dynamic code
evaluation. Stale messages and results after Stop or timeout are ignored.

## Validation and limitations

Run:

```
node oq/test-exact-parser.js
node oq/test-query-worker.cjs
OQ_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core node oq/test-query-browser.cjs
```

The first checks exact parser scope and unchanged normal behavior. The
second uses Node Worker threads with an explicit classic-worker shim and
supports aarch64 reproduction. The third starts Chromium against a local
same-origin HTTP server and tests real UI interaction, Worker loading,
values compared to existing OQ, stop, hard-timeout and startup failure,
no stale messages, no automatic expensive computation, and mobile layout.
It needs a separately installed Playwright runtime, not a production
package dependency. Browser tests do not replace actual mobile-phone QA.

The mathematical backends and their prior exact run records remain under
`counting/`, `affine/` and `active/`. This integration changes neither their
claims nor the TWIST-J Canon. See `ui/RESULT.md` and `ui/RUN.md` for the
actual browser evidence and its scope.
