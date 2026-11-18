"""Reviewer-owned independent toral count check via exact Q(sqrt(5)) pairs.

The two embedding pairs are evaluated using the cosine recurrence in Z[phi],
then compared with a matrix determinant. No writer-owned module is imported.
"""
from fractions import Fraction
from itertools import product
import json


def add(a, b):
    return (a[0]+b[0], a[1]+b[1])


def neg(a):
    return (-a[0], -a[1])


def mul(a, b):
    return (a[0]*b[0]+a[1]*b[1], a[0]*b[1]+a[1]*b[0]+a[1]*b[1])


def power(a, n):
    out = (1,0)
    for _ in range(n):
        out = mul(out, a)
    return out


def cosine(n):
    # c_n = 2 cos(n pi/5), c_0=2, c_1=phi.
    a,b = (2,0), (0,1)
    for _ in range(n):
        a,b = b, add(mul((0,1),b), neg(a))
    return a


def embedding_norm(n):
    stable = add(add((1,0), power((-1,1), 2*n)), neg(mul(power((-1,1),n), cosine(2*n))))
    unstable = add(add((1,0), power((0,1), 2*n)), neg(mul(power((0,1),n), cosine(n))))
    q = mul(stable, unstable)
    assert q[1] == 0 and q[0] > 0
    return q[0]


def mmul(a,b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def determinant(matrix):
    # Fraction-valued Gaussian elimination, different from fraction-free/Bareiss.
    a = [[Fraction(x) for x in row] for row in matrix]
    out = Fraction(1)
    for col in range(len(a)):
        row = next((r for r in range(col,len(a)) if a[r][col]), None)
        if row is None:
            return 0
        if row != col:
            a[col],a[row] = a[row],a[col]
            out = -out
        pivot = a[col][col]
        out *= pivot
        for r in range(col+1,len(a)):
            factor = a[r][col]/pivot
            for c in range(col,len(a)):
                a[r][c] -= factor*a[col][c]
    assert out.denominator == 1
    return out.numerator


def mobius(n):
    sign,p = 1,2
    while p*p <= n:
        if n % p == 0:
            n //= p
            sign = -sign
            if n % p == 0:
                return 0
        p += 1
    return -sign if n > 1 else sign


def run():
    A = [[1,0,-1,1],[0,1,-1,0],[1,0,0,0],[0,1,-1,1]]
    Apower = [[int(i == j) for j in range(4)] for i in range(4)]
    counts, periods = {}, {}
    for n in range(1,121):
        Apower = mmul(Apower,A)
        matrix_count = abs(determinant([[Apower[i][j]-int(i == j) for j in range(4)] for i in range(4)]))
        counts[n] = embedding_norm(n)
        assert matrix_count == counts[n]
        periods[n] = sum(mobius(n//d)*counts[d] for d in range(1,n+1) if n % d == 0)
        assert periods[n] >= 0 and periods[n] % n == 0
        assert sum(periods[d] for d in range(1,n+1) if n % d == 0) == counts[n]
    # Enumerate the actual rational torus grid of denominator 11 independently.
    # Since F_2=11, the finite fixed-point group is killed by 11; this grid
    # contains all points fixed by T^2, not merely a sampling of them.
    def grid_step(v):
        return tuple(sum(A[i][k]*v[k] for k in range(4)) % 11 for i in range(4))
    fixed1 = fixed2 = 0
    for v in product(range(11), repeat=4):
        w = grid_step(v)
        fixed1 += (w == v)
        fixed2 += (grid_step(w) == v)
    assert (fixed1, fixed2) == (1,11)
    return {"result":"pass", "n_min":1, "n_max":120, "fixed_points_n_1_to_8":[counts[n] for n in range(1,9)], "exact_period_points_n_1_to_8":[periods[n] for n in range(1,9)], "exact_period_orbits_n_1_to_8":[periods[n]//n for n in range(1,9)], "torus_grid":{"denominator":11,"points_enumerated":11**4,"fixed_by_T":fixed1,"fixed_by_T_squared":fixed2}, "method":"Exact pair arithmetic in Z[phi] for both embedding modulus squares, using the cosine recurrence, compared against Fraction Gaussian determinant of A^n-I; independent Mobius inversion and cycle divisibility; exhaustive denominator-11 torus grid.", "limit":"Finite computation n=1..120 checks formulas; it does not prove the all-n fixed-point theorem or entropy formula."}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
