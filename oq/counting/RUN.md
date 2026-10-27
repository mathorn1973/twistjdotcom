# Run record

Status: finite engineering execution, candidate-C; acceleration H.
No Canon authority, cross-architecture gate or independent reviewer claim.

Preregistration: 53d289f (full SHA available in Git).
Implementation and exact tests: 5142a37 (full SHA available in Git).
Environment: Linux, architecture x86_64, Node v22.23.4, Python 3.10.12.

Commands, all exit 0 and empty stderr:

```
python3 oq/test-count-matematyka.py
node oq/test-count.js
node oq/test-optimizer.js
node oq/test-qasm3.js
node oq/test-rank.js
```

The pinned Matematyka target is reconstructed from Git in a temporary directory.
The same suite was also run against the current original prototype files,
with all five recorded raw source hashes checked unchanged before/after.
`local-target.stdout.txt` records its raw source hashes. The science digest
matches the normalized reconstruction exactly. This is reproduction only.

A separate Node vm smoke checked the browser-style global OQCOUNT export and
the exact H-T-H amplitude/probability. This is NOT a browser/UI test.

`regressions.json` records the unchanged regression summaries and stdout hashes.
Committed outputs contain no private paths, hostnames, credentials or logs.
No initial implementation test failed; no equality or threshold was relaxed.

Security review: added module has no eval, network, filesystem or process
access. The test harness uses only explicit Git/Python/Node commands and a
temporary source directory. Manual review of new paths and parser delta found
no secrets or unrelated content. Existing tracked implementation files and
all original working copies are unchanged. No deployment performed.

The frozen unified-diff source patch contains single-space blank context
lines. A path-specific .gitattributes rule disables blank-at-eol warnings only
for that patch format; code whitespace checks remain enabled. The patch bytes
and all source hashes are unchanged.
