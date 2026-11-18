"""Independent silver checks: cyclic group convolution and a quadratic norm form.

This reviewer-owned check does not import the manuscript writer's verifier.
It complements, but does not replace, the written proofs.
"""
from itertools import permutations, product
import json


def mul8(a, b):
    # First work in Z[C8], then impose m^(k+4) = -m^k.
    cyclic = [0] * 8
    for i, ai in enumerate(a):
        for j, bj in enumerate(b):
            cyclic[(i + j) % 8] += ai * bj
    return tuple(cyclic[k] - cyclic[k + 4] for k in range(4))


def power(a, n):
    out = (1, 0, 0, 0)
    for _ in range(n):
        out = mul8(out, a)
    return out


def norm_form(v):
    a, b, c, d = v
    s = a*a + b*b + c*c + d*d
    t = a*(b-d) + c*(b+d)
    return s*s - 2*t*t


def det(a):
    total = 0
    for p in permutations(range(len(a))):
        term = (-1) ** sum(p[i] > p[j] for i in range(len(a)) for j in range(i+1, len(a)))
        for i, col in enumerate(p):
            term *= a[i][col]
        total += term
    return total


def multiplication_matrix(v):
    columns = [mul8(v, tuple(int(i == k) for i in range(4))) for k in range(4)]
    return [list(row) for row in zip(*columns)]


def run():
    one, m, M, inverse = (1,0,0,0), (0,1,0,0), (1,-1,1,0), (1,0,-1,-1)
    assert mul8(M, inverse) == one
    assert power(m, 8) == one and all(power(m, n) != one for n in range(1, 8))
    assert power(M, 8) == (577,-408,0,408)
    assert norm_form((1,0,1,0)) == 4
    assert norm_form(M) == norm_form(inverse) == 1
    B = [[1,0,-1,1], [-1,1,0,-1], [1,-1,1,0], [0,1,-1,1]]
    assert B == multiplication_matrix(M) and det(B) == 1
    # Newton identities recover characteristic coefficients from traces,
    # independent of the writer's determinant evaluations.
    traces = [sum(multiplication_matrix(power(M,k))[i][i] for i in range(4)) for k in range(1,5)]
    coefficients = [1]
    for k in range(1,5):
        numerator = -sum(coefficients[k-i]*traces[i-1] for i in range(1,k+1))
        assert numerator % k == 0
        coefficients.append(numerator // k)
    assert coefficients == [1,-4,8,-4,1]
    tested = 0
    for v in product(range(-2, 3), repeat=4):
        a,b,c,d = v
        forward = (a-c+d, b-a-d, c-b+a, d-c+b)
        backward = (a+b+c, b+c+d, -a+c+d, -a-b+d)
        assert mul8(M, v) == forward
        assert mul8(inverse, v) == backward
        assert mul8(inverse, forward) == mul8(M, backward) == v
        assert norm_form(v) == norm_form(forward) == norm_form(backward)
        assert det(multiplication_matrix(v)) == norm_form(v)
        tested += 1
    return {"result":"pass", "tuples":tested, "domain":"{-2,-1,0,1,2}^4", "M_eighth_power":list(power(M,8)), "M_norm":norm_form(M), "one_plus_i_norm":norm_form((1,0,1,0)), "characteristic_coefficients":coefficients, "method":"C8 cyclic convolution with signed folding; independent quartic norm S^2 - 2 T^2 versus determinant; Newton trace recurrence for characteristic coefficients; all roundtrips and norm preservation in the stated finite domain."}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
