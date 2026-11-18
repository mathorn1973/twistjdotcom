# Ordinary Quantum

Open [Ordinary Quantum](index.html) to edit and run OpenQASM in a browser. See [OpenQASM 3 support](QASM3.md) for parser coverage. The console shows exact state probabilities and separate simulated sample counts. Use the same circuit, shot count and seed to repeat a sample.

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
