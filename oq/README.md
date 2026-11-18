# Ordinary Quantum

Open [Ordinary Quantum](index.html) to compare or run OpenQASM circuits in a browser. A fresh console opens with a one-qubit example and waits for **Run**. Return visits restore your saved source. The console displays exact probabilities and separate simulated counts. The same circuit, shot count and seed reproduce a sample. [OpenQASM 3 support](QASM3.md)

## Comparing two circuits

In the [opening experiment](index.html#compare-exactly), both circuits give 0 with probability 1/2. **Apply H to both** reveals a second measurement alongside the first. Circuit A now gives 0 with certainty and B gives 1 with certainty.

Open **Compare your own circuits** to keep A as a reference while editing B. **Compare probabilities** starts each circuit in the all-zero state and compares the selected computational-basis outcomes. Expand the amplitudes to see phase information. For up to four qubits, leaving the bitstring empty shows every outcome. For larger circuits, enter a complete bitstring with the highest-index qubit first.

For all-outcome comparisons, **Simulated samples** adds 256 shots per circuit with seed 20260605. Exact probabilities and amplitudes remain available alongside the sample.

**Compare the whole operation** asks whether two equal-width, exactly representable unitary circuits agree on every input. Its verdict distinguishes exact agreement under Ordinary Quantum’s gate definitions, agreement up to one global phase, and a difference. Expand the exact comparison value for the normalized trace of U†V and its squared magnitude.

For example, S equals two T gates. Identity and Z both leave |0⟩ unchanged, yet give opposite X readouts from |+⟩. For differing operations on up to four qubits, the result gives a preparation, a measurement and the exact probability for each circuit. Each circuit can have up to 16 qubits and 500 lowered gates. A comparison that exceeds the search budget or the six-second deadline reports **Undecided**. You can cancel the worker and keep editing either circuit.

## Bell pairs and exact queries

In the [Bell pair experiment](index.html#bell-pair), compare the chance of one zero with the chance of two zeros. **Flip one phase** leaves the Z-basis probabilities unchanged and reverses the sign of the X correlation. Either **Inspect** button opens the corresponding query with its circuit in the console. Press **Run** to reproduce its exact value or edit the source to try a different preparation.

The console’s **Exact query** mode computes a selected basis amplitude, a joint outcome on specified qubits, or a Pauli expectation. For a joint outcome, the bits follow the order of the entered qubit list. For example, qubits `0,2` and outcome `10` ask for q₀ = 1 and q₂ = 0 with all other qubits unrestricted. The worker computes before terminal readout, accepts static circuits, and can be stopped. The available methods and resource limits depend on the observable. [Exact query controls and limits](QUERY_UI.md)

## Measurement and interference

[Choose a relative phase](index.html#measurement), then run **Measure directly** and **Apply H and measure**. The buttons load the chosen circuit into the editable console and run it in statevector mode.

| Phase applied after the first H | Direct probability of 0 | Probability of 0 after another H |
| --- | ---: | ---: |
| None | 1/2 | 1 |
| Eighth-turn (T) | 1/2 | (2 + √2)/4 |
| Quarter-turn (S) | 1/2 | 1/2 |
| Sign flip (Z) | 1/2 | 0 |

The first H creates equal magnitudes. The phase gate changes only the argument of the amplitude of 1. Another H makes the two amplitudes interfere. A finite sample can differ from the exact probability. [Matematyka’s measurement and interference lesson](https://matematyka.cz/en/kvantum#s2)

## Four or eight boxes

[Choose the search space and target](index.html#grover-search), then run **Run baseline** and **Run one step** with the same settings.

| Search space | Target probability at baseline | Target probability after one Grover step | Each other outcome after one step |
| --- | ---: | ---: | ---: |
| Four boxes | 1/4 | 1 | 0 |
| Eight boxes | 1/8 | 25/32 | 1/32 |

The baseline prepares a uniform state and uses zero queries. The next circuit uses one phase oracle and one diffusion operation. Its oracle uses CZ for two qubits and CCZ for three, with X gates around the oracle for a target containing zeros. The displayed bit order starts with the highest-index qubit. This is a comparison of query counts for the small search model. [Matematyka’s search lesson](https://matematyka.cz/en/kvantum#s9)

## Continuous rotations and circuit links

The **vqe ansatz** preset loads the two-qubit continuous-rotation example from Matematyka’s Ordinary Quantum console. To run it, enable **Approximate**. The console reports the distance and gate cost of each replacement. Its tolerance applies per replacement gate. The output is the exact simulation of the substituted circuit.

Use **Copy circuit link** to share the current QASM as a percent-encoded fragment. Anyone with the link can read the circuit. Opening a valid link loads its QASM into the editor. It waits for **Run** and leaves the saved draft untouched until you edit the source. A link carries the circuit text, with sampling and approximation settings chosen in the receiving console.
