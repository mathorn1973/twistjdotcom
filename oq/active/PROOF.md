# Direct active Pauli compilation: scoped candidate proof

NON-CANONICAL C-OQ-ACTIVE-PHASE-N. Unreviewed candidate mathematical argument.
Executed finite tests are candidate-C. General efficiency remains H.
No physical J statement, external ETH premise or Canon status promotion.

## 1. Existing model and invariant active code

Fix the inherited ring8 static unitary gate model and computational input x.
The Clifford frame is C, and independent columns of B span all X masks of
the transported non-Clifford Pauli axes. Write V|s>=|B s> and r=rank B.
For P=i^p X^x Z^z with x=B d,

    P V|s> = i^p (-1)^(z dot B s) |B(s+d)>
           = V i^p X^d Z^(B^T z)|s>.

Thus every transported rotation preserves im V and restricts to an r-qubit
Pauli rotation with exactly the same phase p. Hermiticity is preserved:
d dot B^T z = x dot z mod 2. Input X gates are included in C before planning.
The physical output is exp(i theta) C V W|0>, with W the product of these
restricted rotations and theta the discarded physical global phase. W is
implemented explicitly; no |a>=W|0> coefficient table is needed.

## 2. Exact signed Pauli diagonalization

Let P=i^p X^x Z^z be Hermitian on r bits. Let nu be the integer number of
positions with both x_j=z_j=1. Then

    P = epsilon tensor_j P_j,
    epsilon = (-1)^((p-nu)/2),    P_j in {I,X,Y,Z}.

The exponent is interpreted modulo 2; p-nu is even. On X positions choose
H, on Y choose H S^dagger (S^dagger executes first), and on Z/I choose I.
Their tensor product D0 maps the unsigned Pauli string to the product of Z
on its support. Choose a target t in the support and let D1 be the product
of CX(j,t) over the other support bits. Since CX(j,t) maps Z_t to Z_j Z_t,
D1 cancels every extra Z_j in that product. Therefore

    D P D^dagger = epsilon Z_t,    D=D1 D0.

The empty support gives epsilon I instead. This proof includes negative
axes and multiple Y factors; discarding the sign is incorrect.

## 3. Rotation compilation and polynomial description size

For w=zeta_8 and integer k define

    R(P,k) = ((1+w^k)I + (1-w^k)P)/2.

On a positive Z axis R is diag(1,w^k), the ordinary phase gate. On a negative
axis it is diag(w^k,1)=w^k diag(1,w^(-k)). Therefore the circuit executes D,
then the signed phase (including global w^k for a negative axis), then
D^dagger. Its complete unitary equals R(P,k), not merely up to phase.
For P=I it is I; for P=-I it is w^k I.

For support size s>0, D uses at most 2s local gates and s-1 CX gates. The
full signed rotation uses at most 6s gates, hence at most 6r. Empty-support
rotations require at most one gate. With t rotations, the raw active circuit
has at most t*max(1,6r) gates. Its Hadamard count is at most 2tr, before
optional exact cancellation. The inherited implementation limits r<=20;
this argument does not claim the current planner supports unbounded r.

The compiler has polynomial storage in the input/frame/active-description
size. It does not allocate a physical 2^q or active 2^r coefficient array.
The downstream phase sum can still take exponential time in its phase rank.

## 4. Exact disjoint-wire shortening

Keep for each wire the stack of live gates touching it. Two equal H gates,
two equal oriented CX gates, or two Z-phase gates on one wire can meet if
the earlier gate is the current top for EVERY wire touched by the later gate.
Every intervening live gate is then disjoint from that support and commutes
with it. Moving the later gate back and applying H^2=I, CX^2=I, or addition
of Z exponents is exact. Removing the earlier index from all involved wire
stacks maintains this invariant. Global phases commute with every gate and
are accumulated modulo eight without deletion. This preserves the whole
unitary and does not expand its description. No approximate identity is used.

## 5. Physical Pauli readout without either statevector

For a physical Hermitian Q, put Q'=C^dagger Q C=i^p X^x Z^z. If x is outside
im B, Q' maps the basis vectors of im V into the disjoint coset x+im B.
Hence V^dagger Q' V=0 and its expectation is zero.

If x=B d, the restriction equals Q_A=i^p X^d Z^(B^T z). Diagonalize it by D
as above. For non-scalar Q_A,

    <Q> = epsilon <0|W^dagger D^dagger Z_t D W|0>
        = epsilon (2 P_(DW|0>)(bit_t=0) - 1).

The affine phase module computes that normalized probability exactly using
its own actual generated Hadamard count, complete endpoint pairing and
phase-fibre multiplicities. Physical H counts, active rank and affine free
dimension never substitute for that normalization. Scalar restrictions are
read directly as +/-1. The discarded physical global phase cancels here,
which is why the API offers observables rather than physical amplitudes.

## 6. Joint events

For measured set M and bit word v,

    Pi_(M,v)=2^(-|M|) sum_(S subset M) (-1)^(v dot S) Z_S.

Evaluate every complete physical Z_S through Section 5 and sum with exact
common denominators. Two individually out-of-span Paulis can have an in-span
product, so products MUST be formed before any zero restriction is applied.
There is no independence assumption. Charge all 2^|M| terms and share the
assignment, query, linear-work and reference-DPLL node budgets across them.

## 7. Composition, remaining hypotheses and exclusions

Correctness depends on the declared OQRANK planner and OQAFFINE/counting
contracts. The new tests compare full rotation matrices to the explicit
formula, full internal active coefficients to the inherited rank arithmetic,
and physical observables to direct dense contractions without the new
Pauli diagonalizer. These are different calculation paths written/tested by
the same session, not blind independent-agent acceptance.

No constant-time integer model, small chi theorem, runtime superiority,
subexponential #SAT implementation or arbitrary-state compression follows.
Ring16, unsupported controls, arbitrary dense input, mid-circuit measurement,
reset, sampling, physical amplitudes and UI deployment are outside scope.
