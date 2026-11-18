/* Paper-specific explanation and controls; exact mathematics is shared with the atlas. */
(function () {
  'use strict';
  const model = window.RotationScaleModel;
  const byId = id => document.getElementById(id);
  let choice = { branch: 'silver', mode: 'scaled', view: 'standard', step: 0 };
  const ns = 'http://www.w3.org/2000/svg';
  const number = x => x === 0 ? '0' : (Math.abs(x) < 0.0001 || Math.abs(x) >= 1e7 ? x.toExponential(6) : Number(x.toPrecision(7)).toString());
  function complex(state) { return number(state.re) + (state.im < 0 ? ' − ' : ' + ') + number(Math.abs(state.im)) + 'i'; }
  function element(coefficients) {
    const powers = ['', 'm', 'm²', 'm³'];
    let result = '';
    coefficients.forEach((coefficient, i) => {
      if (coefficient === 0n) return;
      const absolute = coefficient < 0n ? -coefficient : coefficient;
      const text = (i && absolute === 1n ? '' : absolute.toString()) + powers[i];
      result += result ? (coefficient < 0n ? ' − ' : ' + ') + text : (coefficient < 0n ? '−' : '') + text;
    });
    return result || '0';
  }
  function svg(tag, attrs) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }
  function draw(state) {
    const orbit = model.orbit(choice);
    const scale = Math.max(1, ...orbit.map(point => point.radius));
    const x = point => 220 + 122 * point.re / scale;
    const y = point => 166 - 122 * point.im / scale;
    const layer = byId('orbit-layer');
    layer.replaceChildren();
    layer.append(svg('polyline', { points: orbit.map(p => x(p) + ',' + y(p)).join(' '), fill: 'none', stroke: '#ba896e', 'stroke-width': 1.6 }));
    for (const point of orbit.slice(0, -1)) layer.append(svg('circle', { cx: x(point), cy: y(point), r: 2.3, fill: '#c8a994' }));
    layer.append(svg('circle', { cx: 220 + 122 / scale, cy: 166, r: 5.3, fill: 'none', stroke: '#282c28', 'stroke-width': 1.5 }));
    layer.append(svg('circle', { cx: x(state), cy: y(state), r: 5.5, fill: '#a95432', stroke: '#fffefa', 'stroke-width': 1.5 }));
    byId('plot-scale').textContent = 'Dashed circle: radius ' + number(scale) + (scale > 1 ? ' · rescaled' : '');
    byId('plot-title').textContent = (choice.mode === 'scaled' ? 'Silver step' : 'Pure rotation') + ' in the ' + (choice.view === 'standard' ? 'first' : 'second') + ' embedding';
    byId('plot-description').textContent = 'Step ' + choice.step + ', position approximately ' + complex(state) + ', radius ' + number(state.radius) + '. Exact coefficients: ' + state.coefficients.join(', ') + '.';
  }
  function render() {
    const state = model.state(choice);
    const first = model.state({ ...choice, view: 'standard' });
    const second = model.state({ ...choice, view: 'conjugate' });
    ['a', 'b', 'c', 'd'].forEach((key, i) => { byId('coefficient-' + key).textContent = state.coefficients[i].toString(); });
    byId('element-readout').textContent = element(state.coefficients);
    byId('step-count').textContent = 'Step ' + choice.step + ' / ' + model.MAX_STEP;
    byId('norm-output').textContent = state.norm.toString();
    byId('previous-step').disabled = choice.step === 0;
    byId('next-step').disabled = choice.step === model.MAX_STEP;
    byId('step-slider').value = String(choice.step);
    byId('step-slider').setAttribute('aria-valuetext', choice.step + ' ' + (choice.mode === 'scaled' ? 'silver steps' : 'rotations'));
    for (const mode of ['rotation', 'scaled']) byId('mode-' + mode).setAttribute('aria-pressed', String(choice.mode === mode));
    for (const view of ['standard', 'conjugate']) byId('view-' + view).setAttribute('aria-pressed', String(choice.view === view));
    byId('standard-position').textContent = complex(first);
    byId('conjugate-position').textContent = complex(second);
    byId('standard-radius').textContent = 'Radius ≈ ' + number(first.radius);
    byId('conjugate-radius').textContent = 'Radius ≈ ' + number(second.radius);
    byId('exact-rule').textContent = choice.mode === 'scaled'
      ? 'M: (a,b,c,d) → (a−c+d, b−a−d, c−b+a, d−c+b)'
      : 'm: (a,b,c,d) → (−d,a,b,c)';
    let message;
    if (choice.step === 0) message = 'Start from 1. Try eight silver steps, then compare with pure rotation.';
    else if (choice.mode === 'rotation') message = choice.step % 8 === 0
      ? 'The pure rotation has returned exactly to 1. Eight rotations close this orbit.'
      : 'Pure rotation changes the phase and keeps radius 1 in both embeddings.';
    else message = choice.step % 8 === 0
      ? 'The phase has returned, but the point has not. The first radius shrinks and the second grows; the exact norm is still 1.'
      : 'The silver step turns and scales at once. Switching the view keeps the exact tuple and reveals the reciprocal scale.';
    byId('step-message').textContent = message;
    draw(state);
  }
  for (const mode of ['rotation', 'scaled']) byId('mode-' + mode).addEventListener('click', () => { choice.mode = mode; render(); });
  for (const view of ['standard', 'conjugate']) byId('view-' + view).addEventListener('click', () => { choice.view = view; render(); });
  byId('previous-step').addEventListener('click', () => { if (choice.step > 0) choice.step--; render(); });
  byId('next-step').addEventListener('click', () => { if (choice.step < model.MAX_STEP) choice.step++; render(); });
  byId('eight-steps').addEventListener('click', () => { choice.step = 8; render(); });
  byId('reset-example').addEventListener('click', () => { choice = { branch: 'silver', mode: 'scaled', view: 'standard', step: 0 }; render(); });
  byId('step-slider').addEventListener('input', event => { choice.step = Number(event.target.value); render(); });
  render();
}());
