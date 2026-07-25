#!/usr/bin/env python3
"""Exact check of every kernel identity printed on twistj.com.

Python standard library only. Exact integer and rational arithmetic. No floats
appear in any assertion. The ring is Z[j] = Z[x]/(1 + x + x^2 + x^3 + x^4),
written in the basis (1, j, j^2, j^3), where j = zeta_5 is the twist unit.

The axiom is J = 1 + j^2. Everything below is a consequence, not an input.

Run:  python3 kernel_identities.py
Exit: 0 if every identity holds, 1 otherwise.

The Canon is the authority, not this file. Current head:
https://github.com/mathorn1973/twist-j
"""

from fractions import Fraction
from itertools import permutations
import sys

MOD = 4  # j^4 = -1 - j - j^2 - j^3


def mul(a, b):
    c = [0] * 7
    for i in range(4):
        for k in range(4):
            c[i + k] += a[i] * b[k]
    for d in (6, 5, 4):
        if c[d]:
            t, c[d] = c[d], 0
            for k in range(4):
                c[d - MOD + k] -= t
    return c[:4]


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def power(a, n):
    r = ONE
    for _ in range(n):
        r = mul(r, a)
    return r


ONE = [1, 0, 0, 0]
J_UNIT = [0, 1, 0, 0]          # j
J = [1, 0, 1, 0]               # J = 1 + j^2, the axiom
J_INV = [0, -1, -1, 0]         # -j - j^2
J_BAR = [1, 0, 0, 1]           # conjugate of J, since conj(j^2) = j^3
PHI = [0, 0, -1, -1]           # phi = -j^2 - j^3

RESULTS = []


def check(name, got, want):
    RESULTS.append((got == want, name, got))


def det4(m):
    total = 0
    for p in permutations(range(4)):
        sign = 1
        for i in range(4):
            for k in range(i + 1, 4):
                if p[i] > p[k]:
                    sign = -sign
        term = sign
        for i in range(4):
            term *= m[i][p[i]]
        total += term
    return total


def matmul(a, b):
    return [[sum(a[i][k] * b[k][c] for k in range(4)) for c in range(4)] for i in range(4)]


def charpoly(m):
    """Faddeev-LeVerrier over Q. Returns integer coefficients, leading first."""
    mf = [[Fraction(v) for v in row] for row in m]
    acc, coeffs = mf, [Fraction(1)]
    for k in range(1, 5):
        trace = sum(acc[i][i] for i in range(4))
        ck = -trace / k
        coeffs.append(ck)
        shifted = [[acc[i][c] + (ck if i == c else 0) for c in range(4)] for i in range(4)]
        acc = matmul(mf, shifted)
    assert all(c.denominator == 1 for c in coeffs)
    return [int(c) for c in coeffs]


# the axiom and its immediate shadows
check("J = 1 + j^2 = (1, 0, 1, 0)", J, [1, 0, 1, 0])
check("J^-1 = -j - j^2", mul(J, J_INV), ONE)
check("J . phi = j", mul(J, PHI), J_UNIT)
check("(J - 1)^3 = j", power(sub(J, ONE), 3), J_UNIT)
check("J^5 . phi^5 = 1, so J^5 = phi^-5", mul(power(J, 5), power(PHI, 5)), ONE)
check("phi^2 = phi + 1", power(PHI, 2), add(PHI, ONE))
check("J . Jbar = 2 - phi", mul(J, J_BAR), sub([2, 0, 0, 0], PHI))
check("(2 - phi) . phi^2 = 1, so |J|^2 = phi^-2", mul(power(PHI, 2), sub([2, 0, 0, 0], PHI)), ONE)

# the step matrix: column k is J . j^k
COLS = [mul(J, power(J_UNIT, k)) for k in range(4)]
M_J = [[COLS[k][r] for k in range(4)] for r in range(4)]

check("M_J = [1 0 -1 1; 0 1 -1 0; 1 0 0 0; 0 1 -1 1]",
      M_J, [[1, 0, -1, 1], [0, 1, -1, 0], [1, 0, 0, 0], [0, 1, -1, 1]])
check("entries of M_J lie in {-1, 0, 1}", sorted({v for row in M_J for v in row}), [-1, 0, 1])
check("N(J) = det M_J = 1", det4(M_J), 1)
check("Tr(J) = tr M_J = 3", sum(M_J[i][i] for i in range(4)), 3)
check("charpoly = x^4 - 3x^3 + 4x^2 - 2x + 1", charpoly(M_J), [1, -3, 4, -2, 1])

# the engine: one step is four additions and no multiplication
a, b, c, d = 7, -3, 11, 5
check("step (a,b,c,d) -> (a-c+d, b-c, a, b-c+d)",
      [sum(M_J[r][k] * [a, b, c, d][k] for k in range(4)) for r in range(4)],
      [a - c + d, b - c, a, b - c + d])

if __name__ == "__main__":
    width = max(len(name) for _, name, _ in RESULTS)
    for good, name, got in RESULTS:
        print(f"{'PASS' if good else 'FAIL'}  {name:<{width}}  {got}")
    failed = [name for good, name, _ in RESULTS if not good]
    print()
    if failed:
        print(f"FAILED {len(failed)} of {len(RESULTS)}: {', '.join(failed)}")
        sys.exit(1)
    print(f"ALL PASS, {len(RESULTS)} identities, exact integer arithmetic, no floats")
