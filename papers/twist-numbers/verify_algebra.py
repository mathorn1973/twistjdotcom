"""Exact editorial checks for revision.tex, not a formal Canon probe.

Standard-library arithmetic only. Polynomial reduction supplies the ring
model; a separate permutation expansion supplies matrix determinants.
"""

from itertools import permutations


def trim(p):
    p = list(p)
    while len(p) > 1 and p[-1] == 0:
        p.pop()
    return p


def add(p, q):
    return trim([(p[i] if i < len(p) else 0) +
                 (q[i] if i < len(q) else 0)
                 for i in range(max(len(p), len(q)))])


def mul_poly(p, q):
    result = [0] * (len(p) + len(q) - 1)
    for i, a in enumerate(p):
        for k, b in enumerate(q):
            result[i + k] += a * b
    return trim(result)


def reduce_ring(p):
    p = list(p) + [0] * max(0, 4 - len(p))
    for degree in range(len(p) - 1, 3, -1):
        coefficient = p[degree]
        for k in range(5):
            p[degree - 4 + k] -= coefficient
    return tuple(p[:4])


def product(a, b):
    return reduce_ring(mul_poly(a, b))


def power(a, n):
    result = (1, 0, 0, 0)
    for _ in range(n):
        result = product(result, a)
    return result


def matrix_of(a):
    columns = [product(a, b) for b in BASIS]
    return tuple(tuple(columns[c][r] for c in range(4)) for r in range(4))


def determinant_poly(matrix):
    total = [0]
    for order in permutations(range(4)):
        inversions = sum(order[i] > order[k]
                         for i in range(4) for k in range(i + 1, 4))
        term = [(-1) ** inversions]
        for r, c in enumerate(order):
            term = mul_poly(term, matrix[r][c])
        total = add(total, term)
    return trim(total)


def conjugate(a):
    result = [0, 0, 0, 0]
    for k, coefficient in enumerate(a):
        result = add(result, [coefficient * v for v in power(j, 4 * k)])
    return reduce_ring(result)


def forward(v):
    a, b, c, d = v
    t, u = a - c, b - c
    return t + d, u, a, u + d


def inverse(v):
    A, B, C, D = v
    t = D - A
    b = C + t
    c = b - B
    d = D - B
    return C, b, c, d


ONE = (1, 0, 0, 0)
ZERO = (0, 0, 0, 0)
BASIS = tuple(tuple(int(r == c) for r in range(4)) for c in range(4))
j = BASIS[1]
phi = (0, 0, -1, -1)
J = (1, 0, 1, 0)
J_inv = (0, -1, -1, 0)
phi_inv = (-1, 0, -1, -1)
M_j = ((0, 0, 0, -1), (1, 0, 0, -1), (0, 1, 0, -1), (0, 0, 1, -1))
M_J = ((1, 0, -1, 1), (0, 1, -1, 0), (1, 0, 0, 0), (0, 1, -1, 1))


def main():
    assert reduce_ring([1, 1, 1, 1, 1]) == ZERO
    assert power(j, 5) == ONE
    # The manuscript's closed product formula versus monic long division.
    for a in BASIS:
        for b in BASIS:
            u = mul_poly(a, b)
            u += [0] * (7 - len(u))
            closed = (u[0] - u[4] + u[5], u[1] - u[4] + u[6],
                      u[2] - u[4], u[3] - u[4])
            assert closed == product(a, b)
    print('PASS quotient and product rule on all 16 basis pairs')

    assert product(phi, phi) == reduce_ring(add(phi, ONE))
    assert product(phi, phi_inv) == ONE
    assert conjugate(phi) == phi
    for a, b, c, d in BASIS:
        assert conjugate((a, b, c, d)) == (a-b, -b, d-b, c-b)
    assert power(j, 2) == reduce_ring(add(product(phi_inv, j), [-1]))
    assert power(j, 3) == product(tuple(-v for v in phi_inv), (1, 1, 0, 0))
    # Norm polynomial in formal indeterminates a,b: (a+b*phi)(a+b*(1-phi)).
    phi_conjugate = (1, 0, 1, 1)
    assert reduce_ring(add(phi, phi_conjugate)) == ONE
    assert product(phi, phi_conjugate) == (-1, 0, 0, 0)
    print('PASS golden identities, conjugation, real tower and quadratic norm coefficients')

    assert product(phi, J) == j
    assert product(J, J_inv) == ONE
    assert power(reduce_ring(add(J, [-1])), 3) == j
    assert power(J, 5) == power(phi_inv, 5)
    assert product(J, conjugate(J)) == reduce_ring(add([2], [-v for v in phi]))
    print('PASS unit, explicit inverse, root recovery, fifth power and squared modulus')

    assert matrix_of(j) == M_j
    assert matrix_of(J) == M_J
    for e in BASIS:
        assert forward(e) == product(J, e)
        assert inverse(e) == product(J_inv, e)
        assert inverse(forward(e)) == forward(inverse(e)) == e
    assert sum(M_J[i][i] for i in range(4)) == 3
    det = determinant_poly(tuple(tuple([x] for x in row) for row in M_J))
    assert det == [1]
    characteristic = determinant_poly(tuple(
        tuple([-M_J[r][c], 1] if r == c else [-M_J[r][c]] for c in range(4))
        for r in range(4)))
    assert characteristic == [1, -2, 4, -3, 1]
    phi5_shifted = [0]
    for exponent in range(5):
        term = [1]
        for _ in range(exponent):
            term = mul_poly(term, [-1, 1])
        phi5_shifted = add(phi5_shifted, term)
    assert characteristic == phi5_shifted
    print('PASS matrices, forward/inverse maps, trace, determinant and characteristic polynomial')
    print('Editorial algebra checks complete; no physical or Canon-status conclusion.')


if __name__ == '__main__':
    main()
