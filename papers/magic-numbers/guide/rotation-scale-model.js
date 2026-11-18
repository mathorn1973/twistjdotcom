/* Exact cyclotomic coordinates and numerical complex illustrations.
 * This local mathematical demonstration does not derive a physical model.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RotationScaleModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_STEP = 24;
  const branches = Object.freeze(['golden', 'silver']);
  const modes = Object.freeze(['rotation', 'scaled']);
  const views = Object.freeze(['standard', 'conjugate']);
  const metadata = Object.freeze({
    golden: Object.freeze({
      name: 'Golden branch', rootSymbol: 'j', unitSymbol: 'J', order: 5,
      polynomial: 'x^4 + x^3 + x^2 + x + 1', unitFormula: '1 + j²',
      ratioSymbol: 'φ', ratio: (1 + Math.sqrt(5)) / 2
    }),
    silver: Object.freeze({
      name: 'Silver branch', rootSymbol: 'm', unitSymbol: 'M', order: 8,
      polynomial: 'x^4 + 1', unitFormula: '1 − m + m²',
      ratioSymbol: 'δ', ratio: 1 + Math.sqrt(2)
    })
  });

  function requireChoice(value, allowed, label) {
    if (!allowed.includes(value)) {
      throw new RangeError('Unknown ' + label + '. Expected ' + allowed.join(' or ') + '.');
    }
    return value;
  }

  function branchInfo(branch) {
    return metadata[requireChoice(branch, branches, 'branch')];
  }

  function options(input) {
    if (input === undefined) input = {};
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Expected an options object.');
    }
    const { branch = 'golden', mode = 'scaled', view = 'standard', step = 0 } = input;
    requireChoice(branch, branches, 'branch');
    requireChoice(mode, modes, 'mode');
    requireChoice(view, views, 'view');
    if (!Number.isInteger(step) || step < 0 || step > MAX_STEP) {
      throw new RangeError('Step must be an integer from 0 to ' + MAX_STEP + '.');
    }
    return { branch, mode, view, step };
  }

  function rotate(coordinates, branch) {
    const [a, b, c, d] = coordinates;
    return branch === 'golden' ? [-d, a - d, b - d, c - d] : [-d, a, b, c];
  }

  function advance(coordinates, branch, mode) {
    if (mode === 'rotation') return rotate(coordinates, branch);
    const [a, b, c, d] = coordinates;
    return branch === 'golden'
      ? [a - c + d, b - c, a, b - c + d]
      : [a - c + d, b - a - d, c - b + a, d - c + b];
  }

  // The norm is the determinant of multiplication in the integral basis.
  // Fraction-free Bareiss elimination keeps every intermediate value exact.
  function norm(coordinates, branch) {
    const columns = [coordinates];
    for (let index = 1; index < 4; index++) columns.push(rotate(columns[index - 1], branch));
    const matrix = Array.from({ length: 4 }, (_, row) => columns.map(column => column[row]));
    let previous = 1n;
    let sign = 1n;
    for (let pivotIndex = 0; pivotIndex < 3; pivotIndex++) {
      let pivotRow = pivotIndex;
      while (pivotRow < 4 && matrix[pivotRow][pivotIndex] === 0n) pivotRow++;
      if (pivotRow === 4) return 0n;
      if (pivotRow !== pivotIndex) {
        [matrix[pivotRow], matrix[pivotIndex]] = [matrix[pivotIndex], matrix[pivotRow]];
        sign = -sign;
      }
      const pivot = matrix[pivotIndex][pivotIndex];
      for (let row = pivotIndex + 1; row < 4; row++) {
        for (let column = pivotIndex + 1; column < 4; column++) {
          matrix[row][column] =
            (matrix[row][column] * pivot - matrix[row][pivotIndex] * matrix[pivotIndex][column]) / previous;
        }
        matrix[row][pivotIndex] = 0n;
      }
      previous = pivot;
    }
    return sign * matrix[3][3];
  }

  function state(input) {
    const selected = options(input);
    const { branch, mode, view, step } = selected;
    const info = branchInfo(branch);
    let coefficients = [1n, 0n, 0n, 0n];
    for (let index = 0; index < step; index++) coefficients = advance(coefficients, branch, mode);

    let anglePerStepDegrees;
    if (mode === 'rotation') {
      anglePerStepDegrees = branch === 'golden' ? (view === 'standard' ? 72 : 144) : (view === 'standard' ? 45 : 135);
    } else {
      anglePerStepDegrees = branch === 'golden' ? (view === 'standard' ? 72 : -36) : (view === 'standard' ? 45 : -45);
    }
    const scalePerStep = mode === 'rotation' ? 1 : (view === 'standard' ? 1 / info.ratio : info.ratio);
    const radius = Math.pow(scalePerStep, step);
    const angleDegrees = anglePerStepDegrees * step;
    const phase = ((angleDegrees % 360) + 360) % 360;
    const radians = (phase * Math.PI) / 180;
    // Exact quarter-turn directions avoid displaying a spurious tiny axis component.
    const quadrant = phase / 90;
    const cosine = Number.isInteger(quadrant) ? [1, 0, -1, 0][quadrant] : Math.cos(radians);
    const sine = Number.isInteger(quadrant) ? [0, 1, 0, -1][quadrant] : Math.sin(radians);
    return Object.freeze({
      ...selected,
      coefficients: Object.freeze(coefficients), norm: norm(coefficients, branch),
      order: info.order, rootSymbol: info.rootSymbol,
      stepSymbol: mode === 'rotation' ? info.rootSymbol : info.unitSymbol,
      anglePerStepDegrees, scalePerStep, radius, angleDegrees,
      re: radius * cosine, im: radius * sine
    });
  }

  function orbit(input) {
    const selected = options(input);
    return Object.freeze(Array.from({ length: selected.step + 1 }, (_, step) => state({ ...selected, step })));
  }

  return Object.freeze({ MAX_STEP, branches, modes, views, branchInfo, state, orbit });
}));
