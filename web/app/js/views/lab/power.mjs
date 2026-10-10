import { $, $$, icon, notice, table, fmt, metric, logRun, download } from '../../ui.mjs';
import { tTestSampleSize, tTestPower, proportionsSampleSize, correlationSampleSize, survivalSampleSize, powerCurve, minimumDetectableEffect, sampleSize } from '../../../../lib/science.mjs';
import { lineChart } from '../../charts.mjs';

const ui = { design: 'two-sample' };
const DESIGNS = [['two-sample', 'Two independent groups'], ['paired', 'Paired / pre-post'], ['one-sample', 'One sample'], ['proportions', 'Two proportions'], ['correlation', 'Correlation'], ['survival', 'Time-to-event'], ['mde', 'Detectable effect for fixed n']];

function fields() {
  const common = `<label class="field">Target power<select id="power">${[.8, .85, .9, .95].map(p => `<option value="${p}">${p * 100}%</option>`).join('')}</select></label><label class="field">Two-sided α<select id="alpha"><option>0.05</option><option>0.01</option><option>0.025</option><option>0.1</option></select></label><label class="field">Expected attrition (%)<input id="attr" type="number" min="0" max="79" value="15"></label>`;
  const d = ui.design;
  if (['two-sample', 'paired', 'one-sample'].includes(d)) return `<label class="field">Standardized effect (Cohen’s ${d === 'paired' ? 'dz' : 'd'})<input id="d" type="number" step="0.01" min="0.01" max="5" value="0.5"></label>${d === 'two-sample' ? '<label class="field">Allocation ratio (n₂/n₁)<input id="ratio" type="number" step="0.1" min="0.2" max="5" value="1"></label>' : ''}` + common;
  if (d === 'proportions') return '<label class="field">Proportion in group 1<input id="p1" type="number" step="0.01" min="0.01" max="0.99" value="0.30"></label><label class="field">Proportion in group 2<input id="p2" type="number" step="0.01" min="0.01" max="0.99" value="0.45"></label><label class="field">Allocation ratio (n₂/n₁)<input id="ratio" type="number" step="0.1" min="0.2" max="5" value="1"></label>' + common;
  if (d === 'correlation') return '<label class="field">Expected correlation r<input id="r" type="number" step="0.01" min="-0.99" max="0.99" value="0.3"></label>' + common;
  if (d === 'survival') return '<label class="field">Hazard ratio<input id="hr" type="number" step="0.01" min="0.05" max="20" value="0.7"></label><label class="field">Proportion allocated to group 1<input id="alloc" type="number" step="0.05" min="0.1" max="0.9" value="0.5"></label><label class="field">Overall probability of observing the event<input id="ep" type="number" step="0.05" min="0.05" max="1" value="0.5"></label>' + common;
  return '<label class="field">Participants per group (n₁)<input id="n" type="number" min="3" max="100000" value="50"></label>' + common;
}

async function run() {
  const err = $('#pw-err'), out = $('#pw-out'); err.textContent = '';
  try {
    const power = Number($('#power').value), alpha = Number($('#alpha').value), attrition = Number($('#attr').value) / 100, v = id => Number($(`#${id}`)?.value), d = ui.design;
    let res, html, input = { design: d, power, alpha, attrition };
    if (['two-sample', 'paired', 'one-sample'].includes(d)) {
      const ratio = d === 'two-sample' ? v('ratio') : 1; input = { ...input, d: v('d'), ratio };
      res = tTestSampleSize(v('d'), power, alpha, { design: d, ratio, attrition });
      const curve = powerCurve(v('d'), alpha, { design: d, ratio, from: 3, to: Math.max(40, res.n1 * 2.2) });
      const approx = d === 'two-sample' && ratio === 1 && [.8, .9, .95].includes(power) && [.05, .01].includes(alpha) ? sampleSize(v('d'), power, alpha, attrition) : null;
      html = `<div class="eyebrow">Recruit (after ${fmt(attrition * 100, 0)}% attrition)</div><div class="result-big">${res.recruitTotal.toLocaleString()} <small>participants</small></div>
        <div class="metrics">${metric(d === 'two-sample' ? 'Complete per group' : 'Complete pairs / participants', d === 'two-sample' ? `${res.n1} + ${res.n2}` : res.n1)}${metric('Achieved power', `${fmt(res.achievedPower * 100, 1)}%`)}${metric('Method', res.method)}${approx ? metric('Normal approx. (v0.1)', `${approx.perGroup}/group`, 'for comparison') : ''}</div>
        ${lineChart([{ label: 'Power', points: curve.map(c => [c.n, c.power]) }], { xLabel: d === 'two-sample' ? 'n per group (group 1)' : 'n', yLabel: 'Power', title: 'Power curve', markers: [{ x: res.n1, label: `n = ${res.n1}` }] })}
        <h3>Effect-size sensitivity</h3>${table(['Effect size', 'Complete n (total)', 'Recruit (total)'], [0.2, 0.3, 0.5, 0.8, 1.0].map(e => { const s = tTestSampleSize(e, power, alpha, { design: d, ratio, attrition }); return [e.toFixed(1), s.total.toLocaleString(), s.recruitTotal.toLocaleString()]; }), { numeric: [1, 2] })}`;
    } else if (d === 'proportions') {
      input = { ...input, p1: v('p1'), p2: v('p2'), ratio: v('ratio') };
      res = proportionsSampleSize(v('p1'), v('p2'), power, alpha, { ratio: v('ratio'), attrition });
      html = `<div class="eyebrow">Recruit</div><div class="result-big">${res.recruitTotal.toLocaleString()} <small>participants</small></div><div class="metrics">${metric('Complete per group', `${res.n1} + ${res.n2}`)}${metric('Risk difference', fmt(v('p2') - v('p1'), 3))}${metric('Method', res.method)}</div>`;
    } else if (d === 'correlation') {
      input = { ...input, r: v('r') }; res = correlationSampleSize(v('r'), power, alpha, { attrition });
      html = `<div class="eyebrow">Recruit</div><div class="result-big">${res.recruitTotal.toLocaleString()} <small>participants</small></div><div class="metrics">${metric('Complete observations', res.total)}${metric('Method', res.method)}</div>`;
    } else if (d === 'survival') {
      input = { ...input, hr: v('hr'), allocation: v('alloc'), eventProb: v('ep') }; res = survivalSampleSize(v('hr'), power, alpha, { allocation: v('alloc'), eventProb: v('ep'), attrition });
      html = `<div class="eyebrow">Required events</div><div class="result-big">${res.events.toLocaleString()} <small>events</small></div><div class="metrics">${metric('Total to enrol', res.recruitTotal.toLocaleString(), `${res.total.toLocaleString()} before attrition`)}${metric('Method', res.method)}</div>`;
    } else {
      input = { ...input, n: v('n') }; const mde = minimumDetectableEffect(v('n'), power, alpha); res = { mde, power: tTestPower(mde, v('n'), alpha) };
      html = `<div class="eyebrow">Minimum detectable effect</div><div class="result-big">d = ${fmt(mde, 3)}</div><div class="metrics">${metric('Per group', v('n'))}${metric('Power at MDE', `${fmt(res.power * 100, 1)}%`)}</div>`;
    }
    const runRec = await logRun('power-sample-size', input, res);
    out.innerHTML = html + `<p class="method-note">Two-sided tests. t-test designs use the exact noncentral t distribution (matches G*Power); proportions use the normal approximation with pooled null variance; correlation uses Fisher’s z; time-to-event uses Schoenfeld’s formula for the log-rank test. Ground the effect size in prior evidence or the minimal clinically important difference — not in the recruitment budget.</p><div class="actions"><button class="btn small" id="dl-pw">${icon('download', 14)} Export calculation</button><span class="muted small mono">sha256 ${runRec.inputSha256.slice(0, 16)}…</span></div>`;
    $('#dl-pw').onclick = () => download('cerebro-sample-size.json', JSON.stringify(runRec, null, 2));
  } catch (e) { err.textContent = e.message; out.innerHTML = ''; }
}

export function render(body) {
  body.innerHTML = notice('Planning estimates for common designs. Clustered, multilevel, repeated-measures and adaptive designs need simulation-based or specialised methods.')
    + `<div class="split"><section class="card"><h2>Power & sample size</h2><div class="chips">${DESIGNS.map(([k, l]) => `<button class="chip ${ui.design === k ? 'on' : ''}" data-design="${k}">${l}</button>`).join('')}</div>
      <div class="form-grid" style="margin-top:12px" id="pw-fields">${fields()}</div>
      <button class="btn primary" id="run-pw" style="width:100%">${icon('flask', 16)} Calculate</button><div class="error" id="pw-err" role="alert"></div></section>
      <section class="card"><div id="pw-out"></div></section></div>`;
  $$('[data-design]', body).forEach(b => b.onclick = () => { ui.design = b.dataset.design; render(body); });
  $('#run-pw').onclick = run;
  $$('#pw-fields input, #pw-fields select', body).forEach(el => el.addEventListener('change', run));
  run();
}
