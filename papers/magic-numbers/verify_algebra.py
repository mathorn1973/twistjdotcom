#!/usr/bin/env python3
"""Finite independent checks of the explicit silver identities; standard library only."""
from itertools import permutations, product

ONE = (1, 0, 0, 0)
BASIS = tuple(tuple(int(i == j) for i in range(4)) for j in range(4))

def mul(a, b):
    coefficients = [0] * 7
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            coefficients[i + j] += x * y
    for k in range(6, 3, -1):
        coefficients[k - 4] -= coefficients[k]
    return tuple(coefficients[:4])

def power(a, n):
    result = ONE
    for _ in range(n):
        result = mul(result, a)
    return result

def det(matrix):
    result = 0
    for p in permutations(range(len(matrix))):
        inversions = sum(p[i] > p[j] for i in range(len(p)) for j in range(i + 1, len(p)))
        term = (-1) ** inversions
        for i, j in enumerate(p):
            term *= matrix[i][j]
        result += term
    return result

def matrix(a):
    columns = [mul(a, b) for b in BASIS]
    return [list(row) for row in zip(*columns)]

def norm(a):
    return det(matrix(a))

def forward(a):
    a, b, c, d = a
    return a-c+d, b-a-d, c-b+a, d-c+b

def backward(a):
    a, b, c, d = a
    return a+b+c, b+c+d, -a+c+d, -a-b+d

def conjugate(a):
    a, b, c, d = a
    return a, -d, -c, -b

def sigma(a, r):
    out = [0] * 4
    for k, coefficient in enumerate(a):
        monomial = power(BASIS[1], r*k)
        out = [x + coefficient*y for x, y in zip(out, monomial)]
    return tuple(out)

def verify():
    m = BASIS[1]
    s, delta, delta_inv = (0, 1, 0, -1), (1, 1, 0, -1), (-1, 1, 0, -1)
    M, inverse = (1, -1, 1, 0), (1, 0, -1, -1)
    assert power(m, 4) == (-1, 0, 0, 0)
    assert power(m, 8) == ONE and all(power(m, n) != ONE for n in range(1, 8))
    assert mul(s, s) == (2, 0, 0, 0)
    assert mul(delta, delta_inv) == ONE
    assert mul(M, delta) == m and mul(M, inverse) == mul(inverse, M) == ONE
    assert power(M, 8) == (577, -408, 0, 408)
    assert matrix(m) == [[0,0,0,-1],[1,0,0,0],[0,1,0,0],[0,0,1,0]]
    assert matrix(M) == [[1,0,-1,1],[-1,1,0,-1],[1,-1,1,0],[0,1,-1,1]]
    assert norm(M) == norm(inverse) == 1
    assert norm((1, 0, 1, 0)) == 4
    assert sigma(s, 3) == tuple(-x for x in s)
    assert sigma(M, 3) == mul(tuple(-x for x in delta), power(m, 3))
    # Five evaluations determine equality of two degree-four characteristic polynomials.
    mat = matrix(M)
    for x in (-2, -1, 0, 1, 2):
        shifted = [[(x if i == j else 0) - mat[i][j] for j in range(4)] for i in range(4)]
        assert det(shifted) == x**4 - 4*x**3 + 8*x*x - 4*x + 1
    for b in BASIS:
        assert forward(b) == mul(M, b)
        assert backward(b) == mul(inverse, b)
        assert backward(forward(b)) == forward(backward(b)) == b
    for a in product(range(-2, 3), repeat=4):
        assert backward(forward(a)) == forward(backward(a)) == a
        assert forward(a) == mul(M, a) and backward(a) == mul(inverse, a)
        assert norm(forward(a)) == norm(a)
        assert (conjugate(a) == a) == (a[2] == 0 and a[3] == -a[1])
        # Independent conjugate-product definition versus determinant expansion.
        product_norm = ONE
        for r in (1, 3, 5, 7):
            product_norm = mul(product_norm, sigma(a, r))
        assert product_norm == (norm(a), 0, 0, 0)
    for a, b in product(range(-3, 4), repeat=2):
        assert norm((a, b, 0, -b)) == (a*a - 2*b*b)**2
    return {"status": "passed", "coordinate_cases": 625, "real_norm_cases": 49,
            "basis_maps": 4, "characteristic_polynomial_evaluations": 5,
            "methods": ["integer polynomial reduction modulo x^4+1", "Leibniz determinant expansion", "conjugate product versus determinant"]}

if __name__ == "__main__":
    import json
    print(json.dumps(verify(), indent=2))
