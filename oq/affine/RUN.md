# Execution record

Owner: A. M. Thorn / OQ-AFFINE-20261027-A.
Status: NON-CANONICAL engineering reproduction, candidate-C only.

- Base: 231e70d6d7c5b39bf75cad7da2c4468fa9be2cb1.
- Preregistration: 2ec3d3a5a24944432f75b9d7cffb686e07a7c7b0.
- Preregistration SHA-256: 0efa60a45ee56b7cbcfcf8e1d7dc06bc70a1280aa3bdb225d3727a29d371c44a.
- Implementation/test pin: 462ee0c3fb956b0c07219f29278f16ac59640583.
- Command: `PYTHONDONTWRITEBYTECODE=1 python3 oq/test-affine-matematyka.py`.
- Runtime: Node v22.22.2, Python 3, Linux.
- Architectures: aarch64 and x86_64, separate Git checkouts of the same pin.
- Both exit codes: 0.
- Both stdout lengths: 776 bytes.
- Both stdout SHA-256: d1cc4168a616301f5711b70aebddfb8f0863302ea27615676d1a8e4b84e06bd4.
- Both stderr lengths: 0 bytes.
- Both stderr SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- Scientific digest: 964501178c5064a0639c3aa3e765363fe10efde16346ee837dc149743a452f17.

The target runner reconstructs the newer parser from the public base and
committed source patch, then checks all five normalized engine/parser hashes.
No mutable local website path supplies inputs.

The first acceptance execution passed without a scientific or fixture failure.
The first x86 environment check found no Node executable, before running tests.
A temporary isolated official Node v22.22.2 Linux x64 runtime was downloaded
and checked against that release's SHASUMS256.txt; no system installation or
PATH persistence was performed. The subsequent acceptance run passed.

The initial HTTPS publication attempt had no credentials and changed no
remote ref; the preregistration was then pushed through the existing SSH
connection before implementation acceptance. No force push, rebase or amend.
No independent-agent or official TWIST-J two-architecture gate is claimed.

Unchanged regression commands and exact aarch64 output hashes are recorded
in regressions-aarch64.json. `EXPECTED.txt` is the actual target-acceptance
stdout, not a manually invented expected result. Later documentation-only
commits do not change the implementation/test pin.

The x86 runner's SSH key was read-only, so its attempted evidence push changed
no remote ref. Its exact run-record bytes were placed in Git blob
69f958544aec6d2ed8d687ae79760bc0075b938d through the authorized connector.
The coordinator fetched that Git blob, checked its Git object hash, all four
implementation hashes and the acceptance stdout hash, then committed the
unchanged record with the ordinary author identity.
