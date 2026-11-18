/* Twist Numbers guide. Exact coefficients and norm; approximate complex pictures.
 * The DOM-free API is exported for independent algebraic verification.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TwistNumbersGuide = api;
    if (root.document) {
      try { api.mount(root.document); }
      catch (error) {
        const failure = root.document.getElementById('interaction-failure');
        if (failure) failure.hidden = false;
        console.error('Twist Numbers guide could not load.', error);
      }
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_STEP = 24;
  const MAX_INPUT = 999n;
  const PHI = (1 + Math.sqrt(5)) / 2;
  const DEFAULT = Object.freeze([1n, 0n, 0n, 0n]);

  function tuple(value) {
    if (!Array.isArray(value) || value.length !== 4 || value.some(x => typeof x !== 'bigint')) {
      throw new TypeError('Expected four exact integer coefficients.');
    }
    return value;
  }

  function boundedSeed(value) {
    tuple(value);
    if (value.some(x => x < -MAX_INPUT || x > MAX_INPUT)) {
      throw new RangeError('Each seed coefficient must be from −999 to 999.');
    }
    return value;
  }

  function parseSeed(values) {
    if (!Array.isArray(values) || values.length !== 4) throw new TypeError('Enter four integers.');
    const parsed = values.map((value, index) => {
      const label = 'abcd'[index];
      if (typeof value !== 'string' || !/^[+-]?\d{1,5}$/.test(value.trim())) {
        throw new TypeError('Coefficient ' + label + ' must be a whole number from −999 to 999.');
      }
      const integer = BigInt(value.trim());
      if (integer < -MAX_INPUT || integer > MAX_INPUT) {
        throw new RangeError('Coefficient ' + label + ' must be from −999 to 999.');
      }
      return integer;
    });
    return Object.freeze(parsed);
  }

  function forward(value) {
    const [a, b, c, d] = tuple(value);
    const t = a - c, u = b - c;
    return Object.freeze([t + d, u, a, u + d]);
  }

  function inverse(value) {
    const [A, B, C, D] = tuple(value);
    const t = D - A, b = C + t, c = b - B, d = D - B;
    return Object.freeze([C, b, c, d]);
  }

  function rotate(value) {
    const [a, b, c, d] = tuple(value);
    return [-d, a - d, b - d, c - d];
  }

  // Fraction-free elimination computes the determinant of multiplication by α.
  function norm(value) {
    const columns = [tuple(value).slice()];
    for (let i = 1; i < 4; i++) columns.push(rotate(columns[i - 1]));
    const matrix = Array.from({ length: 4 }, (_, row) => columns.map(column => column[row]));
    let previous = 1n, sign = 1n;
    for (let k = 0; k < 3; k++) {
      let pivotRow = k;
      while (pivotRow < 4 && matrix[pivotRow][k] === 0n) pivotRow++;
      if (pivotRow === 4) return 0n;
      if (pivotRow !== k) {
        [matrix[k], matrix[pivotRow]] = [matrix[pivotRow], matrix[k]];
        sign = -sign;
      }
      const pivot = matrix[k][k];
      for (let row = k + 1; row < 4; row++) {
        for (let column = k + 1; column < 4; column++) {
          matrix[row][column] = (matrix[row][column] * pivot - matrix[row][k] * matrix[k][column]) / previous;
        }
        matrix[row][k] = 0n;
      }
      previous = pivot;
    }
    return sign * matrix[3][3];
  }

  function validateStep(step) {
    if (!Number.isInteger(step) || Math.abs(step) > MAX_STEP) {
      throw new RangeError('The step must be an integer from −24 to 24.');
    }
  }

  function state(seed, step) {
    boundedSeed(seed);
    validateStep(step);
    let value = Object.freeze(seed.slice());
    const update = step < 0 ? inverse : forward;
    for (let i = 0; i < Math.abs(step); i++) value = update(value);
    return value;
  }

  // Only the bounded seed is evaluated as a polynomial in a numerical root.
  // Applying the polar multiplier avoids cancellation in large iterated tuples.
  function embedding(seed, step, view) {
    boundedSeed(seed);
    validateStep(step);
    if (view !== 1 && view !== 2) throw new RangeError('Choose complex embedding 1 or 2.');
    let re = 0, im = 0, l1 = 0;
    seed.forEach((coefficient, power) => {
      const value = Number(coefficient), angle = 2 * Math.PI * ((view * power) % 5) / 5;
      re += value * Math.cos(angle);
      im += value * Math.sin(angle);
      l1 += Math.abs(value);
    });
    // Roundoff at an exact coordinate axis, below the resolution of this picture.
    if (Math.abs(re) < 1e-12 * Math.max(1, l1)) re = 0;
    if (Math.abs(im) < 1e-12 * Math.max(1, l1)) im = 0;
    const phase = ((view === 1 ? 72 : -36) * step % 360 + 360) % 360;
    const quadrant = phase / 90;
    const cosine = Number.isInteger(quadrant) ? [1, 0, -1, 0][quadrant] : Math.cos(phase * Math.PI / 180);
    const sine = Number.isInteger(quadrant) ? [0, 1, 0, -1][quadrant] : Math.sin(phase * Math.PI / 180);
    const scale = Math.pow(PHI, view === 1 ? -step : step);
    const result = { re: scale * (re * cosine - im * sine), im: scale * (re * sine + im * cosine) };
    result.radius = Math.hypot(result.re, result.im);
    return Object.freeze(result);
  }

  function formatNumber(value) {
    if (value === 0 || Object.is(value, -0)) return '0';
    return Number(value.toPrecision(6)).toString().replace(/-/g, '−');
  }

  function tupleText(value) { return '(' + value.join(', ') + ')'; }
  function elementText(value) {
    const basis = ['', 'j', 'j²', 'j³'];
    let result = '';
    value.forEach((coefficient, index) => {
      if (coefficient === 0n) return;
      const magnitude = coefficient < 0n ? -coefficient : coefficient;
      const term = (index > 0 && magnitude === 1n ? '' : magnitude.toString()) + basis[index];
      result += (result ? (coefficient < 0n ? ' − ' : ' + ') : (coefficient < 0n ? '−' : '')) + term;
    });
    return result || '0';
  }
  function complexText(value) {
    return formatNumber(value.re) + (value.im < 0 ? ' − ' : ' + ') + formatNumber(Math.abs(value.im)) + 'i';
  }

  function mount(document) {
    const host = document.getElementById('twist-experiment');
    if (!host || host.dataset.mounted === 'true') return;
    const get = id => document.getElementById(id);
    const inputs = 'abcd'.split('').map(letter => get('seed-' + letter));
    let seed = DEFAULT.slice(), current = DEFAULT.slice(), step = 0, view = 1;
    let lastRule = 'The current state is the seed.';
    const text = (id, value) => { get(id).textContent = value; };

    function plot() {
      const group = get('plot-content');
      while (group.firstChild) group.removeChild(group.firstChild);
      const node = (tag, attributes, content) => {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (content !== undefined) element.textContent = content;
        group.appendChild(element);
        return element;
      };
      const pathSteps = Array.from({ length: Math.abs(step) + 1 }, (_, i) => step < 0 ? -i : i);
      const points = pathSteps.map(n => embedding(seed, n, view));
      const position = points[points.length - 1];
      const next = step < MAX_STEP ? embedding(seed, step + 1, view) : null;
      const plotted = next ? [...points, next] : points;
      const extent = Math.max(1, ...plotted.map(p => Math.max(Math.abs(p.re), Math.abs(p.im)))) * 1.18;
      const px = value => 230 + 162 * value / extent;
      const py = value => 198 - 162 * value / extent;
      const axisColor = '#daddd3';
      node('rect', { x: 42, y: 10, width: 376, height: 376, rx: 188, fill: '#f7f5ef' });
      node('line', { x1: 55, y1: 198, x2: 405, y2: 198, stroke: axisColor });
      node('line', { x1: 230, y1: 23, x2: 230, y2: 373, stroke: axisColor });
      const unitRadius = 162 / extent;
      if (unitRadius >= 6) node('circle', { cx: 230, cy: 198, r: unitRadius, stroke: axisColor, fill: 'none', 'stroke-dasharray': '3 5' });
      node('text', { x: 402, y: 189, 'font-size': 11, fill: '#666b64' }, 'Re');
      node('text', { x: 239, y: 33, 'font-size': 11, fill: '#666b64' }, 'Im');
      node('text', { x: 238, y: 214, 'font-size': 10, fill: '#666b64' }, '0');
      node('text', { x: 398, y: 216, 'text-anchor': 'end', 'font-size': 9, fill: '#666b64' }, formatNumber(extent));
      node('text', { x: 64, y: 216, 'font-size': 9, fill: '#666b64' }, '−' + formatNumber(extent));
      node('polyline', { points: points.map(p => px(p.re) + ',' + py(p.im)).join(' '), fill: 'none', stroke: '#a95432', 'stroke-width': 1.5, 'stroke-linejoin': 'round', opacity: .62 });
      if (next) node('line', { x1: px(position.re), y1: py(position.im), x2: px(next.re), y2: py(next.im), stroke: '#42717a', 'stroke-width': 1.2, 'stroke-dasharray': '4 5' });
      points.forEach(p => node('circle', { cx: px(p.re), cy: py(p.im), r: 2.5, fill: '#a95432', opacity: .65 }));
      const first = points[0];
      node('circle', { cx: px(first.re), cy: py(first.im), r: 8, stroke: '#282c28', 'stroke-width': 1.4, fill: '#fffefa' });
      if (next) node('circle', { cx: px(next.re), cy: py(next.im), r: 5, stroke: '#42717a', 'stroke-width': 1.5, fill: '#fffefa' });
      node('circle', { cx: px(position.re), cy: py(position.im), r: 5.5, fill: '#a95432' });
      node('text', { x: px(position.re), y: py(position.im) - 15, 'text-anchor': 'middle', 'font-size': 12, fill: '#a95432' }, 'n = ' + step);
      const name = view === 1 ? 'first' : 'second';
      text('plot-title', 'Approximate ' + name + ' complex embedding');
      text('plot-description', 'Current step ' + step + ': ' + complexText(position) + '. Seed at ' + complexText(first) + '. ' + (next ? 'The hollow blue point is the next J step. ' : '') + 'Both axes automatically range from minus ' + formatNumber(extent) + ' to plus ' + formatNumber(extent) + '.');
      text('plot-caption', 'Approximate ' + name + ' embedding. Both axes auto-scale to ±' + formatNumber(extent) + '. ' + (next ? 'The dashed segment previews the next J step. ' : '') + 'Segments join discrete values; they do not assert continuous motion.');
    }

    function render(message) {
      'abcd'.split('').forEach((letter, i) => text('coefficient-' + letter, current[i].toString().replace('-', '−')));
      host.querySelector('.coefficients').classList.toggle('long-coefficients', current.some(value => value.toString().length > 6));
      text('step-count', 'n = ' + step.toString().replace('-', '−'));
      text('element-readout', 'α = ' + elementText(current));
      const normText = norm(current).toString();
      text('norm-value', normText);
      host.querySelector('.norm-box').classList.toggle('long-norm', normText.length > 6);
      text('norm-explanation', 'Unchanged from the seed: ' + norm(seed) + '.');
      text('rule-readout', lastRule);
      if (message) text('step-message', message);
      get('forward').disabled = step === MAX_STEP;
      get('inverse').disabled = step === -MAX_STEP;
      get('return-seed').disabled = step === 0;
      [1, 2].forEach(embeddingIndex => {
        const value = embedding(seed, step, embeddingIndex);
        const suffix = embeddingIndex === 1 ? 'one' : 'two';
        const output = get('embedding-' + suffix);
        output.textContent = '';
        const realTerm = document.createElement('span');
        const imaginaryTerm = document.createElement('span');
        realTerm.textContent = formatNumber(value.re);
        imaginaryTerm.textContent = (value.im < 0 ? '− ' : '+ ') + formatNumber(Math.abs(value.im)) + 'i';
        output.appendChild(realTerm);
        output.appendChild(document.createTextNode(' '));
        output.appendChild(imaginaryTerm);
        text('radius-' + suffix, 'Radius ≈ ' + formatNumber(value.radius));
      });
      host.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.view) === view)));
      plot();
    }

    function clearErrors() {
      text('input-error', '');
      inputs.forEach(input => input.removeAttribute('aria-invalid'));
    }

    function load(value, message) {
      boundedSeed(value);
      seed = value.slice();
      current = value.slice();
      step = 0;
      lastRule = 'The current state is the seed ' + tupleText(seed) + '.';
      inputs.forEach((input, i) => { input.value = seed[i].toString(); });
      clearErrors();
      render(message);
    }

    function update(direction) {
      if (Math.abs(step + direction) > MAX_STEP) return;
      const before = current;
      current = direction === 1 ? forward(current) : inverse(current);
      step += direction;
      lastRule = tupleText(before) + ' × ' + (direction === 1 ? 'J' : 'J⁻¹') + ' = ' + tupleText(current) + '.';
      const returned = current.every((value, i) => value === seed[i]);
      const zero = seed.every(value => value === 0n);
      render(zero ? 'Zero stays zero under both maps. Its norm is 0.' : returned ? 'Exactly back at the seed. All four integers match; no rounding was used.' : (direction === 1 ? 'J applied exactly. ' : 'J⁻¹ applied exactly. ') + 'The algebraic norm is unchanged.');
    }

    get('forward').addEventListener('click', () => update(1));
    get('inverse').addEventListener('click', () => update(-1));
    get('return-seed').addEventListener('click', () => load(seed, 'Returned to your seed at n = 0.'));
    get('reset').addEventListener('click', () => {
      view = 1;
      load(DEFAULT, 'Default example restored. Apply J, then J⁻¹ to recover these four integers.');
    });
    get('load-golden').addEventListener('click', () => load([0n, 0n, -1n, -1n], 'The golden unit φ is loaded. Its quartic norm is 1.'));
    get('load-zero').addEventListener('click', () => load([0n, 0n, 0n, 0n], 'Zero is loaded. Both maps leave it at zero.'));
    get('seed-form').addEventListener('submit', event => {
      event.preventDefault();
      clearErrors();
      try { load(parseSeed(inputs.map(input => input.value)), 'Your seed is loaded. Both exact step rules are ready.'); }
      catch (error) {
        text('input-error', error.message);
        let firstInvalid = null;
        inputs.forEach(input => {
          try { parseSeed([input.value, '0', '0', '0']); }
          catch (_) { input.setAttribute('aria-invalid', 'true'); if (!firstInvalid) firstInvalid = input; }
        });
        if (firstInvalid) firstInvalid.focus();
      }
    });
    host.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      view = Number(button.dataset.view);
      render('Same exact coefficients, ' + (view === 1 ? 'first' : 'second') + ' complex view. Changing the embedding does not apply a J step.');
    }));
    if (new URLSearchParams(document.location?.search).get('example') === 'inverse') {
      step = 2;
      current = state(seed, step);
      lastRule = tupleText(seed) + ' × J² = ' + tupleText(current) + '.';
      render('Two J steps from 1. Apply J⁻¹ twice to return to the seed.');
    } else {
      render();
    }
    host.dataset.mounted = 'true';
    host.hidden = false;
  }

  return Object.freeze({ MAX_STEP, MAX_INPUT, DEFAULT, parseSeed, forward, inverse, norm, state, embedding, elementText, mount });
}));
