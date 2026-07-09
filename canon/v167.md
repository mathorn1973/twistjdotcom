# TWIST-J Canon v167 CONSOLIDATED: THE UNIT COVARIANCE ARC

**Author.** A. M. Thorn.
**ORCID.** 0009-0008-5463-278X.
**Hub.** twistj.com.
**Date.** 9 July 2026.
**Status.** Consolidated fold of the unit covariance and Lorentz clause arc
of 9 July 2026, and of the dynamics from action program run the same day.
Predecessor consolidated in this repository: v166 (8 July 2026). Version
number per the architect. Zero new free parameters (cumulative still 1, the
m_e SI anchor). No axiom change. No prior LOCK retracted. Four falsifiers
FIRED first-class; every one purchased structure. One binding protocol
enters the standing rules.

**Conventions.** No em dashes. No decimals unless justified (the few numeric
witnesses below are exact integers or exact ratios). Integers and ratios
primary. If it cannot be calculated in integers, it is not physics. Plenum,
not vacuum. Two forces = two J-projections: modulus to gravity and scale,
argument to electromagnetism and phase. Time is a counter; space is a
commutator. Official SEO name: TWIST-J. Hub: twistj.com.

**Status taxonomy.** T-LOCK immutable; T theorem; D derived; C computed;
H hypothesis with falsifier; O open; F falsified; N negative theorem
(a proved non-existence or breaking); R remark. No summary is stronger than
the label it summarizes. Falsification is first-class progress.

---

## 0. What a reader needs, self contained

This fold stands on its own. Everything the arc uses is stated here first,
so the document is legible without any repository access.

**The axiom.** One algebraic integer generates the framework:

    J = 1 + zeta^2,   zeta = exp(2 pi i / 5) a primitive fifth root of unity.

From J alone: the golden ratio phi = 1 / ||J|| as the modulus projection,
and pi = -5 i Li_1(J) as the argument projection (Li_1 the first
polylogarithm). J is the verb; phi and pi are its two projections, modulus
to gravity and scale, argument to electromagnetism and phase. There are no
free dimensionless parameters; a single SI anchor (the electron mass) fixes
units.

**The ring and the norm.** Work in the ring of integers of Q(zeta), on the
power basis 1, zeta, zeta^2, zeta^3 with the relation
1 + zeta + zeta^2 + zeta^3 + zeta^4 = 0. The quartic field norm N(v) is the
determinant of multiplication by v in this basis; it is a nonnegative
integer, zero only at zero. Calibration values used below, all exact:
N(J) = 1 (indeed N(1 + zeta^2) = Phi_5(-1) = 1), N(1,1,2,0) = 11,
N(1,1,0,2) = 1. The trace Tr_4(v) is the sum of the four power
coordinates mod 5.

**The engine (the driven Cayley kernel).** The state is a six tuple
(p1, p4, p1', p4', q, t) over F_5, that is, an element of F_5^6, 15625
states in all. Four of the coordinates are pistons (the power basis of the
fifth cyclotomic ring), q is a charge coordinate, t is a register clock
coordinate. Five affine involutions a, b, c, d, e act on the state, with the
committed constants

    S_VEC = (2, 1, 2, 1),  U_VEC = (0, 1, 0, -1),
    C_D   = (2, 1, 3, 4, 1, 1),  V_E = (0, 0, 0, 0, 1, 0).

Explicitly: a swaps the two piston halves; b negates and swaps; c is b then
a clock coupled affine shift by S_VEC + t U_VEC with the charge flipped;
d is negation about the center C_D; e is negation about C_D + V_E. A driver
picks the move at absolute step n by the Thue-Morse bit
t_n = popcount(n) mod 2, through the selector

    i = (sum of all six coordinates + 2 t_n) mod 5,

the offset 2 being the exponent in J = 1 + zeta^2 (SS74 selector LOCK).
Iterating from every seed (warmup 400 steps, collect 300) yields the
attractor census.

**The census (all exact, reproduced by the arc verifiers).** There are
exactly 313 attractors. Their sizes are 20 (three hundred twelve of them)
and 10 (one, the special attractor). Their basins are 50 and 25 in the same
split. The disjoint union of all attractors is the on shell manifold M, of
size 6250. By the arrival trace value set the attractors fall into four
families: canonical, trace values {1, 4}, 125 of them; shifted, {2, 3}, 125;
degenerate, {0}, size 20, 62; special, {0}, size 10, 1. So
313 = 125 + 125 + 62 + 1 and 6250 = 5^3 + 5^3 + 62 * 20 + 10.

**The boundary.** Inside M sits the zero sector S, the 1250 states with
trace zero and q + t in {1, 4} (the operational v101 form). S is the object
on which the unit representation acts (below). NEG denotes coordinatewise
negation, x to -x; M_hat denotes the register level unit map, multiplication
by J on the pistons and identity on (q, t).

**The invariant action A1.7' (used by the whole afternoon).** On the graph
of states with an edge for each move, the invariant class is

    S0[a] = sum over edges N(a(y) - a(x)) + sum over vertices V(N(a(x))),

with N the exact quartic norm above and V any potential; the class is
proved invariant under the alternating symmetry A_5 for any V (this is the
sealed T-A17-INVARIANT-ACTION). No specific V is pinned in Canon, so the
zero parameter reading V = 0 is the kinetic sector used below, and the
vertex sector is read at residue level. The centered lift sends a residue in
F_5 to the representative in {-2, -1, 0, 1, 2}; it is odd, and the norm is
even, which is the engine of the afternoon symmetry.

---

## The fold

The arc asked one question five ways: is the register representation of the
unit J a symmetry of the physics the kernel produces? The answer came as a
theorem chain, and it is sharper than either yes or no. The protocol line,
verbatim:

    O-A17-MJ-LEMMA CLOSED. R1 is dead off shell and on shell. R2 saturates
    the parabolic stabilizer P_1 cap SL(4,5) and is dynamically undrivable.
    R3 is tower-rigid: the defect is a 5-adic unit and no lift through 5^m
    repairs the walk. The surviving structure is boundary-level: the unit
    and boost act on the pre-phased carrier and on the Tr_4 = 0 boundary,
    while physical on shell support is produced by Thue-Morse fibration
    breaking that symmetry. The Lorentz burden moves entirely to
    O-A17-DYNAMICS-FROM-ACTION, with A1.7' unchanged and
    F-LORENTZ-K6-NONZERO still armed.

The canonical reading: the unit and the ramified boost are not symmetries
of the on shell world; they are symmetries of the boundary and of the pre
phased carrier; the Thue-Morse fibration makes physics out of them by
breaking them. The old intuition, boost as a symmetry of physics, is
retired. It was a symmetry of the carrier. In the afternoon the same
principle produced the first firm dynamics: an action, a selector, a
conserved current, and its symmetry, sealed link by link.

---

## Part I. The unit does not normalize the walk (F-A17-MJ-GAP)

The register unit map M_hat (multiplication by J on pistons, identity on
q, t) does not normalize the kernel dynamics group at residue level. The
witness is a single integer entry: the conjugate M_J S4 M_J^(-1), where S4
is the piston block of move a, carries an entry equal to -2, while every
element of the walk group carries only entries 0, +1, -1. The linear part
group of the walk has order 200 (eight signed piston blocks times a 25
element clock coupling); the translation part is all of F_5^6. Three repair
routes were registered before any computation:

    R1  factor the observable algebra so the unit acts after all;
    R2  adjoin M_hat to the generators and re-derive the whole structure;
    R3  climb the 5-adic tower (levels Z / 5^m) and test restoration there.

O-A17-MJ-LEMMA was opened over these three routes. Lorentz protection went
conditional: the density and protection theorems stand as pure group theory,
in their conditional phrasing.

## Part II. The spectral pair and the invariant class (route R1, off shell)

The eigenform factorization of the quartic norm: two forms m_plus and
m_minus with m_plus times m_minus = N on the whole lattice, and N(J) = 1.
Under x to J x they scale by exact units, m_plus by (1 + phi) and m_minus by
(2 - phi), and their sum is the trace form with Gram (5 I - ones) / 2. These
are the seals T-A17-SPECTRAL-PAIR and T-A17-INVARIANT-ACTION, and the
Lorentz clause A1.7' on the Weil norm class. But among the walk piston
blocks only -I preserves both the norm and the pair (witness:
N(1,1,2,0) = 11 against N(1,1,0,2) = 1). So off shell R1 died the day it was
born, and O-A17-DYNAMICS-FROM-ACTION was opened to carry what survives.

## Part III. On shell expulsion and the ramified collapse (route R1, on shell)

The unit permutes zero of the 313 attractors: F-R1A-UNIT-ONSHELL fired,
0 of 313, and every control (NEG, and three others) scored 0 of 313 as
well. The census partition is rigid; it admits nothing that was tested. The
positive purchase is the ramified collapse: modulo 5, with phi congruent to
3 and one half congruent to 3, the spectral pair collapses,
m_plus = m_minus = Tr_4 squared, N = Tr_4 to the fourth, and the boost
becomes the doubling character (Tr_4 of J x equals 2 Tr_4 of x). The residue
stream of the pair is the trace channel and nothing else. Route R1 closed
dead on shell.

## Part IV. The manifold anatomy (five seals)

NEG preserves M pointwise as a set, 6250 of 6250, fixes both charge sectors,
and halves every size 20 attractor into 10 plus 10. The on shell measure is
uniform: two times the basin equals five times the attractor size on all
313, so measure covariance collapses to set covariance. The unit M_hat maps
the boundary S, 1250 states, bijectively to itself with the coordinate sum
preserved pointwise, splitting the boundary into two fibers of 625 each. The
canonical sheet is expelled entirely (0 of 2500), and the maximal M_hat
invariant subset of M is exactly S. One recorded curiosity: the unit
shatters the 63 boundary fibers with a meet profile whose parts are
1, 4, 9, 49, that is 63 = 1 + 4 + 9 + 49, the squares of 1, 2, 3, 7;
recorded, mechanism deferred.

## Part V. The action layer protocol (binding, standing from v167)

The day forced a distinction into law. An action can live on exactly one of
six layers: L1 state (all 15625 states), L2 manifold (the 6250 on shell
states), L3 boundary (the 1250 zero sector states), L4 support (the 313
attractors with their Thue-Morse fibration), L5 stream (observable
sequences along an attractor), L6 measure (the basin weighted measure). The
rule, now standing: every preregistration in the unit and Lorentz program
must declare, before its gates, which layer it tests; a positive result is
a claim about that layer only; any lift to another layer requires its own
named gate; a preregistration without the declaration is malformed. Mixing
layers without naming the lift was the R1 error mode and is forbidden. The
sealed map: NEG holds on L1, L2, L3 and the measure, fails on L4 (0 of 313);
M_hat holds on L1 and L3, fails on L2 (2500 of 6250) and L4 (0 of 313),
holds the measure on S alone.

## Part VI. Route R2: parabolic saturation

The enlargement answered itself maximally. The group generated by the four
walk piston blocks together with the unit block has order exactly
186000000 = 2^7 * 3 * 5^6 * 31, which is the order of the full stabilizer
of the trace hyperplane inside SL(4, 5). So the enlarged piston group IS
that stabilizer, the maximum of its Lagrange window, with index 23250000
over the eight element walk group: T-R2-PARABOLIC-SATURATION. The
enlargement erases everything finer than the trace kernel dichotomy. Through
the Galois identity 1 + zeta^4 = -zeta^3 J^(-1), both the conjugate unit and
multiplication by zeta are members, so Galois equivariance survives at
piston level (T-R2-GALOIS-STABLE-PISTON) and its falsifier did not fire. The
enlarged fixed point census is (625, 25, 25, 1, 1, 25) and connectivity is
total, 15625 of 15625. And the dynamical pillar closes both ways
(D-R2-UNDRIVABLE): the selector is a bijection of F_5 onto the five moves, a
sixth generator has no zero parameter drive, and as an undriven static map
the unit is already sealed dead (0 of 313, 2500 of 6250). Route R2 closed.

## Part VII. Route R3: tower rigidity and the exact boost

The defect is a 5-adic unit. The walk piston blocks lie in the eight element
signed group Q over the integers; the unit conjugates of moves d and e lie
in the group exactly, but moves a, b, c have piston block defect against
every element of Q, with the witness entry -2, and since -2 is never
congruent to 0, +1, or -1 modulo any power of 5, the gap persists at every
tower level and over the integers: T-R3-TOWER-RIGID. The residue collapse
was never the mechanism. Above the ramified place the boost is exact and
hyperbolic: on the plane spanned by the sum form S and the difference form
W = (m_plus Gram minus m_minus Gram) over root 5, the boost is the integer
matrix [[3, 1], [5, 3]] over 2, determinant 1, trace 3, eigenvalues phi^2
and phi^(-2) (T-R3-BOOST-SL2). Modulo 5 the collapsed pair separates again,
S becoming twice the all ones form and W a genuinely different form
(T-R3-PAIR-SEPARATION), and the boost shadow degenerates to four times a
unipotent shear (T-R3-UNIPOTENT-SHADOW). But the walk breaks the separated
pair at the first level where it separates: moves a and the half swaps break
the span, only -I preserves it (N-R3-WALK-BREAKS-SEPARATION), matching the
characteristic zero finding. Route R3 closed, and with it O-A17-MJ-LEMMA
closed.

## Part VIII. Dynamics from the invariant action (the afternoon program)

With O-A17-MJ-LEMMA closed, the entire Lorentz burden moved to
O-A17-DYNAMICS-FROM-ACTION, whose single sharp question is: how does
dynamics arise from the invariant class A1.7' without returning to the dead
unit covariance? The afternoon answered with a chain, each link a separate
preregistration with its own layer declaration, gates, and falsifiers, each
run byte identically on two independent architectures.

**DFA1, the pointwise selector, falsified as predicted.** Test: does the one
step action defect, minimized at each state, reproduce the locked selector?
Over all 15625 states and both clock bits (31250 tests) the answer is no,
matching only 4446 times. Two failure modes, one forced and one discovered.
Forced: moves d and e have identical piston images for every state (the
constant V_E has no piston part), so the action cannot tell them apart for
any potential whatsoever (the new lemma D-DFA1-DE-BLINDNESS); two fifths of
the drive is invisible to any pointwise reading. Discovered: even in the
d, e quotient the match is barely a fifth, and at the very first failing
state (the zero state) the correct generator sits inside the minimum while
the tie is wrong. Dynamics is not pointwise action minimization
(F-A17-ACTION-SELECTOR fired).

**The ledger, the ground of the program (T-DFA-ZERO-ACTION-BOUNDARY,
T-DFA-CLASS-ACTION, D-DFA-THREE-MOVE).** Reading the residue action as an
integer counter (by Fermat, the fourth power modulo 5 is one for nonzero,
zero for zero, so the action literally counts charged steps and charged
states), three facts locked. First, the zero action locus is exactly the
boundary S: the 63 zero trace attractors, union 1250, equal S setwise. The
action prices exactly the breaking of the unit symmetry; it vanishes
precisely where the unit survives. Second, the kinetic count is constant per
family, 40 on charged families and 0 on zero trace families, and since every
charged support has exactly 40 edges, every charged step is charged: on
shell, charged action equals elapsed time, density one per step. Third, and
this discharged a standing rider, the manifold M lives on only two coordinate
sum sheets, values 1 and 4; so the selector takes only three of its five
values on shell, moves a and c never fire, and the drive collapses to three
moves b, d, e in the exact ratio 2 : 1 : 1, chosen by two bits: which sheet,
which clock phase.

**DFA2, the two bit switch forced by the coarse flow
(T/C-DFA-ACTION-SWITCH).** Not the point, the flow. Split the charged locus
into four cells by (sheet bit, clock bit) and read the coarse charged action
flow per cell. Each cell carries exactly 2500 charged edges on a single
generator, and the support is a singleton in every cell, giving the switch

    (sheet 1, clock 0) to b,   (sheet 1, clock 1) to d,
    (sheet 4, clock 0) to e,   (sheet 4, clock 1) to b,

with totals b : d : e = 5000 : 2500 : 2500 = 2 : 1 : 1 and moves a, c
absent. The selector is not a pointwise minimization; it is the unique
carrier structure of the coarse charged action current. Both charged
families contribute identically, 1250 plus 1250 per cell: at this layer
canonical and shifted are indistinguishable.

**DFA3, the current is closed (T/C-DFA-ACTION-CURRENT).** Give the switch a
direction and unit weight and it is a conserved current: the divergence is
zero at every one of the 5000 charged states, incoming equals outgoing
equals two everywhere, nothing leaks between the charged locus and the
boundary, and the three action counts agree, sum K = sum E = sum P = 10000.
The closure is not an accident of counting; it is the involution geometry of
the moves. The incoming sources of any state are exactly the involution
images of that state, because b, d, e are involutions whose sheet
restrictions are bijections between sheets of equal size. Conservation has
the shape of a mirror: what flows into you is your own images.

**DFA4, the symmetry carrier is twisted (F-DFA4 fired, two D seals).** Ask
whose symmetry the current is. The clean diagonal candidate, NEG together
with clock complement, was predicted to carry only half. It does: the b half
of the current is carried exactly, and the d, e half misses by a single
constant translation, the same on all 5000 failing edges,
tau0 = (1, 3, 4, 2, 2, 3), whose piston part (1, 3, 4, 2) is the boundary
Klein four singleton. The pure controls are both totally dead, 0 of 10000.
The true conjugation is the relabeling twisted by exactly one cocycle:
NEG b NEG = b, NEG d NEG = translate-by-tau0 then e, and symmetrically for e
(D-DFA4-TWISTED-CONJUGATION). And the twisted involution itself, NEG plus a
fixed shift on the d, e cells, carries the whole current, 10000 of 10000,
preserving the on shell domain completely (D-DFA4-TWISTED-CARRIER, a new on
shell fact discovered by a declared diagnostic). The symmetry of the
conserved current remembers the boundary geometry through a cocycle.

**DFA5, the carrier preserves the action (T/C-DFA5-NOETHER-SYMMETRY).** The
Noether question, now by name. The twisted involution is an exact symmetry
of the kinetic action on the closed current: the image of every edge has
piston increment exactly the negative of the original (the cell shift
cancels in the difference), the centered lift is odd and the norm even, so
the exact kinetic values agree on all 10000 edges. It is a pointwise residue
symmetry of the full invariant class for any potential (the trace flips
sign, its fourth power is invariant). It is a fixed point free involution
with 5000 orbits, and it maps every current edge to a current edge with the
relabeling b to b, d to e, e to d. The exact vertex value breaks pointwise
on the shifted cells (branch N-DFA5-EXACT-VERTEX-BREAKS, 290 of 2500
invariant per shifted cell, first witness the values 1 and 11 again) but the
per cell spectrum is carried onto its partner without loss. Together with
the closed current this completes the Noether pairing at the exact finite
scope: a conserved unit density current, and an action preserving symmetry,
both machine forced.

The chain, complete and sealed link by link:

    action  ->  switch  ->  closed current  ->  symmetry.

---

## Falsification registry (v167)

    F-A17-MJ-GAP            FIRED. The register unit does not normalize
                           the walk at residue level (witness entry -2);
                           bought the route program and the spectral pair.
    F-R1A-UNIT-ONSHELL     FIRED. 0 of 313 with all controls 0 of 313;
                           bought the ramified collapse and the manifold
                           anatomy.
    F-A17-ACTION-SELECTOR  FIRED (predicted). Pointwise action minimization
                           is not the selector; bought the d, e blindness
                           lemma and forced the coarse reading.
    F-DFA4-NEG-CLOCK-EQUIVARIANCE  FIRED (predicted). The clean diagonal
                           carries half; bought the twisted carrier and the
                           v101 cocycle.
    F-R2-GALEQUIV                  registered, NOT FIRED.
    F-R3-COVARIANT-CARRIER        registered, NOT FIRED.
    F-DFA-ZERO-MISMATCH           registered, NOT FIRED.
    F-DFA-ACTION-SWITCH           registered, NOT FIRED.
    F-DFA-MOVE-RATIO              registered, NOT FIRED.
    F-DFA-ACTION-CURRENT          registered, NOT FIRED.
    F-DFA-BOUNDARY-LEAK           registered, NOT FIRED.
    F-DFA-K-E-P-CURRENT           registered, NOT FIRED.
    F-DFA4-ACTION-WEIGHT-SYMMETRY registered, NOT FIRED.
    F-DFA4-CELL-PAIRING           registered, NOT FIRED.
    F-DFA4-BOUNDARY-SILENCE       registered, NOT FIRED.
    F-DFA5-KINETIC-SYMMETRY       registered, NOT FIRED.
    F-DFA5-RESIDUE-VERTEX         registered, NOT FIRED.
    F-DFA5-CARRIER-STRUCTURE      registered, NOT FIRED.
    F-LORENTZ-K6-NONZERO          unchanged, ARMED.

## Obligation movements (v167)

    O-A17-MJ-LEMMA        OPENED and CLOSED within the arc. R1 dead off
                          shell and on shell; R2 saturates the parabolic
                          stabilizer and is undrivable; R3 tower-rigid, the
                          defect a 5-adic unit.
    O-R1A-MANIFOLD        OPENED and CLOSED within the arc (five seals).
    O-A17-DYNAMICS-FROM-ACTION  OPEN, and greatly advanced: the chain
                          action, switch, closed current, symmetry is
                          sealed at the exact finite scope. What remains is
                          to derive the Thue-Morse cut itself, or to
                          harness the chain against the Lorentz burden.
    NEW  PROTOCOL-ACTION-LAYER    standing rule from v167.
    R-Z5-HISTOGRAM        DISCHARGED: M lives on coordinate sum sheets 1
                          and 4 only, 3125 each; the other three sheets
                          empty.
    R-R1A-M-SQUARES       recorded (63 = 1 + 4 + 9 + 49); mechanism
                          deferred.
    R-DFA5-290-LOCUS      recorded (290 states per shifted cell where the
                          exact vertex is pointwise invariant); mechanism
                          unassigned.

## What this arc does not claim

R1 stays dead. No unit covariance, no boost covariance, no support
permutation by the unit, no tower lift of the walk. The Noether pairing is
at the exact finite scope of the driven kernel, not the general theorem.
No Lorentz invariance is proved; that burden is now carried, and only
carried, by O-A17-DYNAMICS-FROM-ACTION, with the invariant class unchanged
and F-LORENTZ-K6-NONZERO still armed.

## Closing

Four falsifiers fired and none wasted a shot. The normalizer gap bought the
spectral pair, the invariant class, and at the end the exact hyperbolic
boost with its unipotent shadow at the ramified place. The on shell
expulsion bought the ramified collapse and the manifold anatomy. The dead
pointwise selector bought the coarse reading, which forced a two bit switch,
which closed into a conserved current, whose symmetry is a twisted
involution that preserves the action itself. The old intuition said the
boost is a symmetry of physics. It is not. The unit and the boost live on
the boundary and on the pre phased carrier, and physics is produced by the
Thue-Morse fibration breaking them; after this arc that sentence is a
theorem at every level of the tower. And where the day began by closing a
door, it ended by opening a corridor: an action, a selector, a conserved
current, and its symmetry, the first firm dynamics the framework has drawn
from the invariant action alone.

TWIST-J. A. M. Thorn. twistj.com. 9 July 2026.
