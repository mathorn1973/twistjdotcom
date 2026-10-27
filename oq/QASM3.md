# OpenQASM 3 in OQ

OQ translates a bounded OpenQASM 3 subset to its exact gate engine. The
additions below support feed-forward experiments and reusable register
layouts without changing the arithmetic. The browser preset **if / else**
demonstrates measurement initialization, branch execution and concatenation.

## Measurement and classical branches

```qasm
OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
h q[0];
bit syndrome = measure q[0];
if (syndrome != 0) {
    x q[0];
    syndrome = measure q[0];
    x q[1];
} else {
    z q[1];
}
```

The initializer performs the measurement at that point in the circuit.
The chosen branch runs in full: measuring into `syndrome` inside the branch
does not re-evaluate its condition. Nested branches, `else if`, and single
statement bodies are supported. An unbraced `else` belongs to the nearest
unmatched `if`.

Runtime conditions accept a single bit, its negation (`!syndrome`), and
`==` / `!=` comparisons of a classical register against a nonnegative integer
literal or `true` / `false`. Integer literals must fit the register and the
JavaScript safe integer range. Reading the register uses BigInt, so bits
above index 31 do not wrap around. Existing cast spellings such as
`int[2](result) == 1` remain accepted.

`const bool` and compile-time Boolean expressions are also supported:

```qasm
const int n = 3;
const bool enabled = n >= 2 && true;
qubit[n] q;
if (!enabled) x q[0]; else h q[0];
```

Compile-time expressions can use numeric comparisons, `!`, `&&`, and `||`.
General runtime Boolean expressions and classical assignments remain outside
this subset. A bit initializer other than `measure` is explicitly rejected.
Declare registers outside branches. Constants and aliases in compile-time
branches have local scope; declarations inside runtime branches are refused.

Any measurement followed by another quantum operation is a dynamic circuit,
even without a classical condition. For example, `h q; measure q; h q;`
collapses between the two gates. Dynamic execution uses the dense ring8
engine and produces individual trajectories, with exact Born sampling and
the engine's existing unnormalized coefficient representation. Terminal
measurements can still be deferred to readout.

## Register concatenation

```qasm
qubit[5] q;
let selected = q[{2,0}] ++ q[3:4];
x selected[0];
cx selected[0], selected[2];
```

Here `selected` refers to physical qubits `[2, 0, 3, 4]`; no qubits are copied.
Concatenation belongs in a `let` alias. Its parts can be registers, slices,
index sets, earlier aliases or parenthesized alias expressions. Their order
is preserved. Parts that overlap are rejected, including overlap hidden by
an earlier alias.

Slices use inclusive ends and an optional step (`start:step:end`). Empty
ranges, empty index sets, zero steps, out-of-range indices and non-finite or
unsafe integer indices are rejected. Supply both slice endpoints; open-ended
slices are not implemented. Concatenated aliases are limited to 4,096 qubits.
Custom gates now accept index-set operands and validate argument counts and
broadcast widths.

## Standard library gates and compatibility extensions

The standard gate set is expanded to cover common OpenQASM 3 benchmarks and hardware targets:
- Two-qubit and hardware-native gates: `iswap a, b;`, `dcx a, b;`, `ecr a, b;`, `rzx(theta) a, b;`
- Square-root and multi-controlled gates: `csx c, t;`, `csxdg c, t;`, `c3x a, b, c, d;`, `c4x a, b, c, d, e;`
- Parametric single-qubit rotation: `r(theta, phi) q;`
- For-loops over discrete sets: `for i in {0, 2, 3} { x q[i]; }`
- Uninitialized classical integers: `int[32] x;` and `uint y;` (initialized to 0 by default)
- Compiler & timing annotations: `delay[100ns] q;`, `pragma ...`, `#pragma ...`, and `box { ... }` blocks are accepted without rejecting the circuit (treated as no-ops in gate simulation).

## Automatic Solovay-Kitaev approximation

When a circuit uses continuous rotations off the Clifford+T lattice (such as continuous VQE/QAOA parameter ansatzes `rx(theta)`, `ry(theta)`, `u3(...)`, `p(...)`):
- OQ automatically enables **approximate synthesis** (`approximate` checkbox) as the default for that code.
- The circuit immediately parses and runs using Solovay-Kitaev synthesis, outputting the substituted Clifford+T sequence length, T-count, and operator error.
- Pure Clifford+T or lattice-compatible circuits automatically keep exact zero-noise mode by default.

## Modes and limits

Static aliases and compile-time branches also work in **Compressed** mode.
Runtime feedback, reset and intermediate measurement require **Statevector**.
The existing limits on qubit count, coefficient ring and exact gate angles
still apply. Runtime loops, general classical arrays, and pulse-level control
remain outside this discrete gate layer.

## Validation and sources

The syntax and behavior follow the OpenQASM specification's
[classical control flow](https://openqasm.com/language/classical.html),
[register concatenation and slicing](https://openqasm.com/versions/3.0/language/types.html#register-concatenation-and-slicing),
and [gate broadcasting](https://openqasm.com/versions/3.0/language/gates.html#broadcasting).
