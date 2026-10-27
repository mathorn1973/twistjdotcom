# Exact affine phase reduction: candidate derivation

C-OQ-AFFINE-PHASE-N. NON-CANONICAL. Unreviewed candidate mathematical
argument; executed software evidence is candidate-C. No Canon T is asserted.
All statements concern the declared finite gate model, not Nature or native J.

## 1. Carrier and path identity

Fix R in {8,16}, zeta=exp(2*pi*i/R), a static lowered unitary circuit U,
and a computational-basis input x. Supported gates are H, X, CX, SWAP,
integer zpow, mask-controlled phases and global phases. There are h H gates.
For H with input a and output b,

    H[b,a] = 2^(-1/2) zeta^(R*a*b/2).

Give each H output one Boolean variable. Every z in F2^h determines one
history. Other gates either update bits deterministically or add a phase.
Multiplication of matrix entries and summation over intermediate states gives

    <y|U|x> = 2^(-h/2) sum_(F(z)=y) zeta^f(z).

Induction over gates shows every current wire is an affine Boolean form in z:
X complements, CX adds, SWAP permutes, H introduces a new variable, and
phases leave wires unchanged. Consequently F(z)=b+A z.
The phase is stored as a sum modulo R of weighted products of affine forms.
Products are Boolean conjunctions, not multiplication in F2. In particular,
XOR inside a factor is interpreted as a Boolean value before the integer
phase weight is applied. No distribution of a parity into integer monomials
is needed. This representation retains exactly the gate phases, including
global phase for amplitude queries.

## 2. Endpoint elimination

Gaussian elimination with exact XOR provides either an inconsistency or a
bijection between solutions of A z=y-b and F2^(h-rho), rho=rank A.
The substitution z=z0+B t maps each free assignment to exactly one history.
Thus the amplitude histogram counts ordinary unweighted histories, not
projected or multiply represented solutions.

For a diagonal event E, expand the Born square:

    P(E) = 2^(-h) sum_(F(z)=F(z') in E) zeta^(f(z)-f(z')).

Equality of ALL output bits is necessary: the trace over unmeasured basis
states pairs only equal endpoints. Let delta=z+z'. The change (z,z') to
(z,delta) is bijective. Constraints become

    A delta=0,    A_E z=y_E-b_E.

They concern disjoint coordinates and have ranks rho and rho_E. If consistent,
the affine solution dimension is d=2h-rho-rho_E. If inconsistent it is empty.
The implementation eliminates the equivalent block system directly and
checks its rank against this identity. No event is renormalized by conditioning.

## 3. Quotienting directions absent from the phase

After endpoint substitution, simplify products containing zero or both l and
1+l, remove constant-one and duplicate factors (l^2=l on Boolean inputs),
and combine identical products modulo R. These identities preserve f pointwise.
Let the linear parts of the remaining affine factors span dimension chi in
(F2^d)*. Choose a basis b_1,...,b_chi of that span. The map

    B: F2^d -> F2^chi, t |-> (b_1(t),...,b_chi(t))

is surjective by row rank and has kernel dimension d-chi. Every affine factor
is a constant plus a linear combination of the b_i. Therefore the entire
phase equals g(B t) for a factored function g, and every B-fibre has size
2^(d-chi). For every residue r modulo R,

    #{t:f(t)=r} = 2^(d-chi) #{u in F2^chi:g(u)=r}.

This proves the multiplicity, including chi=0 and d=0. It does not identify
chi with a minimal representation or prove that any computationally difficult
phase has small chi. Cancellation can make an amplitude zero while the
histogram still has positive entries; compare the full histogram in tests.

## 4. Reconstruction and bit costs

If N_r counts paths (or paired paths), zeta^(r+R/2)=-zeta^r, so combine
N_r-N_(r+R/2) in the basis 1,zeta,...,zeta^(R/2-1). For even h, amplitudes
have denominator 2^(h/2). For odd h, multiply the numerator by

    sqrt(2) = zeta^(R/8) + zeta^(-R/8)

and use denominator 2^((h+1)/2). Probabilities use denominator 2^h. Removing
common powers of two is exact. The original h, not d or chi, sets the scale.
The histogram sum is exactly 2^d on a consistent system, and zero otherwise.
Counts have at most 2h+1 bits. Coefficient arithmetic and bitset operations
must be charged; a symbolic work unit is not a constant-time arithmetic model.

The direct phase route enumerates 2^chi points using polynomial storage in the
symbolic input. The existing rank route separately stores 2^r coefficients.
No polynomial-space theorem is claimed for the entire hybrid using rank.

## 5. Ordinary #3SAT

Give chi independent phase coordinates one Boolean variable each. Build every
parity, product and fixed-width phase-accumulator bit with AND/XOR gates.
Encode each gate by a full equivalence using clauses of width at most three.
Induction over this acyclic circuit gives exactly one auxiliary extension
for each independent coordinate assignment. Pinning the phase to r filters
these extensions without changing multiplicity. An inconsistent endpoint
adds an empty clause. The formula has no weights or projected variables.

Multiply the resulting model counts by 2^(d-chi) before original reconstruction.
The total number N of CNF variables INCLUDES auxiliaries. In general N is not
chi, q or d. An external count procedure is a separate correctness premise.
No new algorithm or time bound for #SAT is used by this implementation.

## 6. Existing rank engine and joint projectors

For compatible ring8 probability inputs, the existing engine represents
C V |a>. A computational input x is prepared by X gates before that circuit.
For measured set M and specified values v,

    Pi_(M,v) = product_(j in M) (I+(-1)^v_j Z_j)/2
             = 2^(-|M|) sum_(S subset M) (-1)^(sum_(j in S)v_j) Z_S.

Linearity of expectation therefore gives a joint Born event from existing
Pauli expectations, without assuming independence of measured bits. Each
expectation is aligned to a common exact power-of-two denominator before
addition. The cost includes 2^|M| readouts. Global phases cancel in these
expectations; hence the frame is allowed only for probabilities, not amplitudes.
Single-control phases are zpow, empty masks are global phase, and two-control
power four is CZ. Other controlled phases and ring16 are outside this route.

## 7. Honest scope of composition

Auto selection chooses a semantically valid exact route by declared structural
proxies. It is a selection mechanism, not an optimal algorithm theorem. It
preserves access to the existing Clifford compression and independently
provides affine-plus-phase reduction. It does not feed the internal active
vector into an affine phase compiler. Tensor contraction, sampling, dynamic
circuits, arbitrary input vectors and physical interpretations remain outside
this result. Correctness is independent of the claimed external ETH result.
