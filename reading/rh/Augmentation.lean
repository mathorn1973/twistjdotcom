import Std

/-!
A finite model of augmentation at X_p = 1. Run with Lean 4.33.1.
Prime-power factorizations are inputs. The variables below index the
split directions. Choosing and proving the arithmetic rapidity lift is
the input from Public Canon v116.
-/
namespace Rapidity

abbrev Degree := Nat → Int
abbrev Term := Degree × Int
abbrev Shell := List Term

def zeroDegree : Degree := fun _ => 0

def axis (p : Nat) (direction : Int) : Degree :=
  fun q => if q = p then direction else 0

def aug : Shell → Int
  | [] => 0
  | (_, c) :: rest => c + aug rest

def shift (a : Term) (b : Term) : Term :=
  (fun p => a.1 p + b.1 p, a.2 * b.2)

def product : Shell → Shell → Shell
  | [], _ => []
  | a :: rest, other => other.map (shift a) ++ product rest other

theorem aug_append (u v : Shell) : aug (u ++ v) = aug u + aug v := by
  induction u with
  | nil => simp [aug]
  | cons a rest ih => simp [aug, ih, Int.add_assoc]

theorem aug_shift (a : Term) (v : Shell) :
    aug (v.map (shift a)) = a.2 * aug v := by
  induction v with
  | nil => simp [aug]
  | cons b rest ih => simp [aug, shift, ih, Int.mul_add]

theorem aug_product (u v : Shell) : aug (product u v) = aug u * aug v := by
  induction u with
  | nil => simp [product, aug]
  | cons a rest ih =>
    simp [product, aug_append, aug_shift, ih, aug, Int.add_mul]

/-- The exponent is 1 + extra. `split` records the arithmetic prime type. -/
structure PrimePower where
  p : Nat
  split : Bool
  extra : Nat

def unitShell : Shell := [(zeroDegree, 1)]

def localShell (q : PrimePower) : Shell :=
  if q.split then
    [(zeroDegree, if q.extra = 0 then 1 else 2),
     (axis q.p 1, -1), (axis q.p (-1), -1)]
  else if q.extra = 0 then [(zeroDegree, -1)] else []

def localMobius (q : PrimePower) : Int := if q.extra = 0 then -1 else 0

theorem aug_local (q : PrimePower) : aug (localShell q) = localMobius q := by
  cases q with
  | mk p split extra =>
    cases split <;> cases extra <;> rfl

def shellFor : List PrimePower → Shell
  | [] => unitShell
  | q :: qs => product (localShell q) (shellFor qs)

def mobiusFor : List PrimePower → Int
  | [] => 1
  | q :: qs => localMobius q * mobiusFor qs

theorem aug_factorization (qs : List PrimePower) : aug (shellFor qs) = mobiusFor qs := by
  induction qs with
  | nil => rfl
  | cons q rest ih => simp [shellFor, mobiusFor, aug_product, aug_local, ih]

/-- A centered coefficient can survive even when augmentation vanishes. -/
def coefficientAtZero11 (s : Shell) : Int :=
  (s.map (fun t => if t.1 11 = 0 then t.2 else 0)).sum

example : coefficientAtZero11 (localShell ⟨11, true, 1⟩) = 2 := by decide
example : aug (localShell ⟨11, true, 1⟩) = 0 := by decide

/-- Given separate two-sided estimates for a signed reconstruction and its
error, their sum bounds the target at each scale. Neither input estimate is
assumed to follow from the finite augmentation identity. -/
theorem transfer_at_scale (target reconstructed sourceBound errorBound : Int)
    (sourceLo : -sourceBound ≤ reconstructed) (sourceHi : reconstructed ≤ sourceBound)
    (errorLo : -errorBound ≤ target - reconstructed)
    (errorHi : target - reconstructed ≤ errorBound) :
    -(sourceBound + errorBound) ≤ target ∧ target ≤ sourceBound + errorBound := by
  omega

end Rapidity
