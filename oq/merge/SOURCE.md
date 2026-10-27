# Actual OQ source on Fractal, sampled October 27, 2026

Source directory: `/mnt/c/j/matematyka/prototypes/kvantovy-kasar/oq`.
It is a working prototype, excluded from the Matematyka deployment by its
`_tests/deploy-package.py`. Public URL `/prototypes/kvantovy-kasar/oq/`
returned HTTP 404 on October 27. The other public URL `/oq/` also returned 404.

`/mnt/c/j/twistjdotcom` has many uncommitted working-tree changes. Its engine
sources differ in line endings but normalize byte-identically to Fractal
prototype for oq.js, oq16.js, oqopt.js, oqrank.js, oqsparse.js, oqsynth.js.
No edits are made to that working tree or to the prototype.

The two files intentionally imported, removing CRLF only:

- `qasm.js`: raw SHA256 `baa6b7113febf13f7ffa72c970fa29f60182ea78d23d6acbaa6d31e53897e0b7`;
  normalized SHA256 `8336152fa2662d33e619020e2eb3d3c72c75ac3c564450292cd4fc67188fc56c`.
- `QASM3.md`: raw SHA256 `030679ddcc6dcb1bf21e23937fb49a79e84acd72205099f46193bc6ad70890d1`;
  normalized SHA256 `ad100ba3d90a422aea396dfd17bd6eea8082dacfe0856cf71a13565340f64320`.

New gate aliases and decomposition: c3x, c4x, dcx, iswap, csx, csxdg, ecr,
rzx and r. QASM3 adds brace-valued loop forms, box, delay and pragma
handling, and broader variable declarations. Site-local typography,
icons, back navigation and QASM handoff behavior from the prototype's
index.html are NOT transplanted into the stand-alone twistj.com/oq page.
