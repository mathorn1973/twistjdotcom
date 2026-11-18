(() => {
    'use strict';

    const get = id => document.getElementById(id);
    const left = get('compare-left');
    const right = get('compare-right');
    const fields = get('compare-fields');
    const resultBox = get('compare-result');
    const status = get('compare-status');
    const cancel = get('compare-cancel');
    const exampleActions = get('compare-example-actions');
    const exampleApply = get('compare-example-h');
    const exampleReset = get('compare-example-reset');
    const exampleSummary = get('compare-example-summary');
    const exampleResult = get('compare-example-result');
    const originalExampleSummary = exampleSummary.textContent;
    const consoleSource = get('src');
    const editLeft = get('compare-edit-left');
    const outcome = get('compare-bitstring');
    const sampleOption = get('compare-samples');
    const exampleSource = 'OPENQASM 3;\ninclude "stdgates.inc";\nqubit q;\n';
    const operationExamples = {
        strict: ['s q;', 't q;\nt q;'],
        projective: ['x q;', 'gphase(pi);\nx q;'],
        different: ['id q;', 'z q;'],
    };
    const maxTimeMs = 6000;
    let active = null;
    let requestId = 0;

    if (typeof Worker !== 'function' || location.protocol === 'file:') {
        status.textContent = 'Open this page over HTTP or HTTPS to compare circuits. The example’s direct probabilities are shown above.';
        return;
    }

    function node(tag, text) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function row(values) {
        const line = node('tr');
        const heading = node('th', values[0]);
        heading.scope = 'row';
        line.append(heading, ...values.slice(1).map(value => node('td', value)));
        return line;
    }

    function probabilityRows(rows) {
        return rows.map(item => row([
            '|' + item.bitstring + '⟩',
            item.leftProbability,
            item.rightProbability,
        ]));
    }

    function makeTable(caption, body, rowLabel = 'Outcome') {
        const table = node('table');
        table.className = 'compare-table';
        const head = table.createTHead().insertRow();
        for (const label of [rowLabel, 'A', 'B']) {
            const cell = node('th', label);
            cell.scope = 'col';
            head.append(cell);
        }
        table.createCaption().textContent = caption;
        table.createTBody().append(...body);
        return table;
    }

    function setBusy(busy) {
        fields.disabled = busy;
        cancel.hidden = !busy || active.example;
        const showedExample = exampleResult.hasChildNodes();
        exampleApply.setAttribute('aria-disabled', String(busy || showedExample));
        exampleReset.disabled = busy || !showedExample;
    }

    function finish(job, callback) {
        if (job !== active) return;
        clearTimeout(job.timer);
        job.worker.terminate();
        active = null;
        try { callback(); }
        finally { setBusy(false); }
    }

    function execute(query, readResult, readError, start, example = false) {
        if (active) return;
        const id = ++requestId;
        let worker;
        try {
            worker = new Worker('oqcompare-worker.js');
        } catch {
            readError('The comparison worker could not start.');
            return;
        }
        const job = { worker, example };
        active = job;
        setBusy(true);
        start();
        worker.addEventListener('message', ({ data }) => {
            if (!data || data.id !== id) return;
            finish(job, () => {
                if (data.ok) readResult(data.result);
                else readError(data.error);
            });
        });
        worker.addEventListener('error', () => {
            finish(job, () => readError('The comparison worker could not complete the request.'));
        });
        worker.addEventListener('messageerror', () => {
            finish(job, () => readError('The comparison worker returned an unreadable result.'));
        });
        job.timer = setTimeout(() => {
            finish(job, () => readResult({
                status: 'undecided',
                reason: 'The worker stopped after six seconds.',
            }));
        }, maxTimeMs);
        try {
            worker.postMessage({ id, ...query });
        } catch {
            finish(job, () => readError('The comparison request could not be sent.'));
        }
    }

    function readState(result) {
        if (result.status === 'undecided') {
            status.textContent = result.reason || 'Undecided within the calculation limit.';
            return;
        }
        const oneOutcome = Boolean(outcome.value.trim());
        const scope = oneOutcome ? ' for this outcome' : ' in the measurement basis';
        status.textContent = 'Exact probabilities ' + (result.status === 'equal' ? 'match' : 'differ') + scope + '.';
        resultBox.append(makeTable('Probabilities from the all-zero input', probabilityRows(result.rows)));
        const amplitudes = node('details');
        amplitudes.append(node('summary', 'Show exact amplitudes'));
        amplitudes.append(makeTable('Amplitudes before measurement', result.rows.map(item => row([
            '|' + item.bitstring + '⟩', item.leftAmplitude, item.rightAmplitude,
        ]))));
        resultBox.append(amplitudes);
        if (result.samples) {
            const samples = node('details');
            samples.append(node('summary', 'Show simulated counts'));
            const { shots, seed } = result.samples;
            samples.append(makeTable(shots + ' shots per circuit · seed ' + seed, result.rows.map(item => row([
                '|' + item.bitstring + '⟩', String(item.leftCount), String(item.rightCount),
            ]))));
            resultBox.append(samples);
        }
    }

    function readOperation(result) {
        const descriptions = {
            strict: 'Same operation, including global phase.',
            projective: 'Same operation up to one common global phase.',
            different: 'Different operations.',
            undecided: 'Undecided within the calculation limit.',
        };
        status.textContent = descriptions[result.status];
        if (result.reason) resultBox.append(node('p', result.reason));
        if (result.witness) renderWitness(result.witness, result.status);
        if (result.overlap !== undefined) {
            const evidence = node('details');
            evidence.append(node('summary', 'Exact comparison value'),
                node('p', 'Normalized trace overlap: ' + result.overlap),
                node('p', 'Squared magnitude: ' + result.overlapSquared));
            resultBox.append(evidence);
        }
    }

    function renderWitness(witness, classification) {
        const label = classification === 'projective' ? 'Amplitude example' : 'Distinguishing witness';
        resultBox.append(node('h4', label));

        const ket = bits => '|' + bits + '⟩';
        if (witness.experiment) {
            const { preparation, projection, leftProbability, rightProbability } = witness.experiment;
            const describe = ({ kind, words }) => {
                const [first, second] = words;
                if (kind === 'basis') return ket(first);
                return '(' + ket(first) + (kind === 'imaginary' ? ' + i' : ' + ') + ket(second) + ')/√2';
            };
            resultBox.append(node('p', 'Prepare ' + describe(preparation) + ' and measure the projection onto ' + describe(projection) + '.'));
            resultBox.append(makeTable('Exact probability of this projection', [
                row(['Projection', leftProbability, rightProbability]),
            ]));
        }
        const entries = witness.reference ? [witness.reference, witness] : [witness];
        const arrows = item => ket(item.input) + ' → ' + ket(item.output);
        resultBox.append(makeTable('Exact transition amplitudes', entries.map(item =>
            row([arrows(item), item.leftAmplitude, item.rightAmplitude])), 'Transition'));
        if (witness.kind === 'probability') {
            resultBox.append(makeTable('Exact transition probabilities', [
                row([arrows(witness), witness.leftProbability, witness.rightProbability]),
            ], 'Transition'));
        }
        if (witness.reference) {
            resultBox.append(node('p', 'No one global phase relates A and B across these two transitions.'));
        }
    }

    function compare(mode) {
        const bits = outcome.value.trim();
        resultBox.replaceChildren();
        if (mode === 'state' && bits && !/^[01]+$/.test(bits)) {
            status.textContent = 'An outcome bitstring must use only 0 and 1.';
            return;
        }
        const query = { mode, left: left.value, right: right.value };
        if (mode === 'state' && bits) query.bitstring = bits;
        if (mode === 'state' && !bits && sampleOption.checked) {
            query.shots = 256;
            query.seed = 20260605;
        }
        execute(query, mode === 'state' ? readState : readOperation, error => {
            status.textContent = error;
        }, () => {
            status.textContent = 'Comparing circuits…';
        });
    }

    function setReferenceEditable(editable) {
        left.readOnly = !editable;
        editLeft.textContent = editable ? 'Hold reference' : 'Edit reference';
        if (editable) left.focus();
    }

    editLeft.addEventListener('click', () => setReferenceEditable(left.readOnly));
    get('compare-copy-left').addEventListener('click', () => {
        left.value = consoleSource.value;
        setReferenceEditable(false);
        status.textContent = 'Console circuit copied to A.';
        resultBox.replaceChildren();
    });
    get('compare-copy-right').addEventListener('click', () => {
        right.value = consoleSource.value;
        status.textContent = 'Console circuit copied to B.';
        resultBox.replaceChildren();
    });
    for (const input of [left, right, outcome]) {
        input.addEventListener('input', () => {
            status.textContent = 'Ready to compare.';
            resultBox.replaceChildren();
        });
    }

    outcome.addEventListener('input', () => { sampleOption.disabled = Boolean(outcome.value.trim()); });

    get('compare-run-state').addEventListener('click', () => compare('state'));
    get('compare-load-example').addEventListener('click', () => {
        const [a, b] = operationExamples[get('compare-operation-example').value];
        left.value = exampleSource + a;
        right.value = exampleSource + b;
        outcome.value = '';
        sampleOption.disabled = false;
        setReferenceEditable(false);
        resultBox.replaceChildren();
        status.textContent = 'Example pair loaded. Choose Compare operations to run it.';
    });
    get('compare-run-unitary').addEventListener('click', () => compare('unitary'));
    cancel.addEventListener('click', () => {
        if (active) finish(active, () => {
            status.textContent = 'Comparison cancelled.';
        });
    });

    exampleApply.addEventListener('click', () => {
        if (exampleResult.hasChildNodes()) return;
        const start = exampleSource + 'h q;\n';
        execute({ mode: 'state', left: start + 'h q;', right: start + 'z q;\nh q;' }, result => {
            if (result.status === 'undecided') {
                exampleSummary.textContent = result.reason || 'The comparison was undecided.';
                return;
            }
            exampleResult.replaceChildren(makeTable('After H on both', probabilityRows(result.rows)));
            exampleSummary.textContent = 'A gives |0⟩ and B gives |1⟩ with certainty. The second H made the relative phase visible to this measurement.';
        }, error => {
            exampleSummary.textContent = error;
        }, () => {
            exampleSummary.textContent = 'Applying H to both…';
        }, true);
    });

    exampleReset.addEventListener('click', () => {
        exampleResult.replaceChildren();
        exampleSummary.textContent = originalExampleSummary;
        setBusy(false);
    });

    status.textContent = 'Ready to compare.';
    setBusy(false);
    exampleActions.hidden = false;
})();
