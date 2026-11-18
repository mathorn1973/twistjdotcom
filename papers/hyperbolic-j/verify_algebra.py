#!/usr/bin/env python3
"""Exact checks supporting the written proof; standard library only."""
from itertools import permutations, product
from math import prod
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
M = [[1, 0, -1, 1], [0, 1, -1, 0], [1, 0, 0, 0], [0, 1, -1, 1]]
I = [[int(i == j) for j in range(4)] for i in range(4)]

def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def det(a):
    return sum((-1) ** sum(p[i] > p[j] for i in range(4) for j in range(i + 1, 4)) *
               prod(a[i][p[i]] for i in range(4)) for p in permutations(range(4)))

def mul(a, b):
    """Polynomial convolution modulo x^4+x^3+x^2+x+1."""
    c = [0] * 7
    for i in range(4):
        for j in range(4):
            c[i + j] += a[i] * b[j]
    for i in range(6, 3, -1):
        for k in range(1, 5):
            c[i - k] -= c[i]
    return c[:4]

def power(a, n):
    out = [1, 0, 0, 0]
    for _ in range(n):
        out = mul(out, a)
    return out

def conjugate(a, r):
    root = power([0, 1, 0, 0], r)
    result = [0] * 4
    for k, v in enumerate(a):
        term = power(root, k)
        result = [x + v * y for x, y in zip(result, term)]
    return result

def norm(a):
    """Independent norm: multiply all four reduced conjugates, no determinant."""
    answer = [1, 0, 0, 0]
    for r in range(1, 5):
        answer = mul(answer, conjugate(a, r))
    assert answer[1:] == [0, 0, 0]
    return answer[0]

def step(v):
    a, b, c, d = v
    t, u = a - c, b - c
    return [t + d, u, a, u + d]

def inverse(v):
    A, B, C, D = v
    t = D - A
    b = C + t
    c = b - B
    d = D - B
    return [C, b, c, d]

def run():
    assert det(M) == 1
    J = [1, 0, 1, 0]
    for v in product(range(-2, 3), repeat=4):
        v = list(v)
        assert step(v) == mul(v, J)
        assert inverse(v) == mul(v, [0, -1, -1, 0])
        assert inverse(step(v)) == v == step(inverse(v))
    mn, jn, counts, rows = I, [1, 0, 0, 0], {}, []
    for n in range(1, 33):
        mn, jn = matmul(mn, M), mul(jn, J)
        a = [[mn[i][j] - I[i][j] for j in range(4)] for i in range(4)]
        delta = jn.copy()
        delta[0] -= 1
        fixed = abs(det(a))
        assert fixed == abs(norm(delta)) > 0
        exact = fixed - sum(counts[d] for d in range(1, n) if n % d == 0)
        assert exact >= 0 and exact % n == 0
        counts[n] = exact
        rows.append({"n": n, "fixed": str(fixed), "exact_period_points": str(exact), "exact_period_orbits": str(exact // n)})
    # Concrete quotient return: M^2*x = x + e1, but M*x != x modulo Z^4.
    lift = [-2, 1, 2, 6]
    assert step(lift) == [2, -1, -2, 5]
    assert step(step(lift)) == [9, 1, 2, 6]
    assert [v % 11 for v in step(lift)] != [v % 11 for v in lift]
    result = {"status": "passed", "schedule_inputs": 625, "norm_comparisons": 32,
              "methods": ["permutation determinant of integer matrix powers", "polynomial convolution and conjugate product modulo Phi_5"],
              "scope": "Finite exact checks support the written all-n proof; no native U or physical claim checked.", "counts": rows}
    (ROOT / "algebra-checks.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("PASS: 625 schedule inputs, 32 independent norm/determinant comparisons, exact-period divisibility and rational 2-cycle.")
    print(json.dumps(rows[:8]))

if __name__ == "__main__":
    run()
