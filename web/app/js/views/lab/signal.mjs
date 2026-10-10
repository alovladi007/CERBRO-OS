import { $, esc, icon, notice, fmt, metric, logRun, download, compute, toast } from '../../ui.mjs';
import { lineChart, heatmap } from '../../charts.mjs';
import { parseCSV } from '../../../../lib/csv.mjs';

const ui = { source: 'synthetic', fs: 256, seconds: 8, alpha: 10, amp: 1.5, noise: 0.6, line: 50, pink: 1, nperseg: 512, hp: 0.5, lp: 45, notch: 50, csv: null, channel: 0 };

function synth() {
  const n = Math.round(ui.fs * ui.seconds), out = new Array(n);
  let s = 11; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296), gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // 1/f background via summed random-phase sinusoids
  const comps = Array.from({ length: 60 }, (_, k) => { const f = 0.5 + k * 0.75; return { f, a: ui.pink / Math.pow(f, 0.9), ph: rnd() * 2 * Math.PI }; });
  for (let i = 0; i < n; i++) {
    const t = i / ui.fs, burst = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.15 * t);
    let v = ui.amp * burst * Math.sin(2 * Math.PI * ui.alpha * t) + 0.5 * Math.sin(2 * Math.PI * 5.5 * t + 1) + 0.35 * Math.sin(2 * Math.PI * 21 * t);
    for (const c of comps) v += c.a * Math.sin(2 * Math.PI * c.f * t + c.ph) * 0.12;
    if (ui.line) v += 0.8 * Math.sin(2 * Math.PI * ui.line * t);
    out[i] = v + ui.noise * gauss();
  }
  // a brief simulated movement artifact
  for (let i = Math.round(n * .62); i < Math.round(n * .64); i++) out[i] += 9 * Math.sin(Math.PI * (i - n * .62) / (n * .02));
  return out;
}

const decimate = (arr, max = 1800) => { const step = Math.max(1, Math.ceil(arr.length / max)); const pts = []; for (let i = 0; i < arr.length; i += step) pts.push([i, arr[i]]); return pts; };

async function samples() {
  if (ui.source === 'synthetic') return synth();
  if (ui.source === 'paste') { const raw = $('#paste').value.trim(); if (!raw) throw Error('Paste numeric samples first.'); const v = raw.split(/[\s,;]+/).map(Number); if (v.some(x => !Number.isFinite(x))) throw Error('All samples must be numeric.'); return v; }
  if (!ui.csv) throw Error('Load a CSV with one column per channel.');
  return ui.csv.rows.map(r => Number(r[ui.channel])).filter(Number.isFinite);
}

async function analyze() {
  const err = $('#sig-err'); err.textContent = '';
  const btn = $('#run-sig'); btn.disabled = true;
  try {
    ui.fs = Number($('#fs').value); ui.nperseg = Number($('#nperseg').value);
    ui.hp = Number($('#hp').value) || 0; ui.lp = Number($('#lp').value) || 0; ui.notch = Number($('#notch').value) || 0;
    if (!(ui.fs >= 16 && ui.fs <= 50000)) throw Error('Sampling rate must be between 16 and 50,000 Hz.');
    const raw = await samples();
    if (raw.length < 64) throw Error('Use at least 64 samples.');
    if (raw.length > 5e6) throw Error('Signals up to 5 million samples are supported.');
    const filt = { highpass: ui.hp || undefined, lowpass: ui.lp && ui.lp < ui.fs / 2 ? ui.lp : undefined, notch: ui.notch && ui.notch < ui.fs / 2 ? ui.notch : undefined };
    const x = filt.highpass || filt.lowpass || filt.notch ? await compute('filterSignal', raw, ui.fs, filt) : raw;
    const nperseg = Math.min(ui.nperseg, 2 ** Math.floor(Math.log2(x.length)));
    const [w, wRaw, spec, art] = await Promise.all([compute('welch', x, ui.fs, { nperseg, overlap: 0.5 }), compute('welch', raw, ui.fs, { nperseg, overlap: 0.5 }), compute('spectrogram', x, ui.fs, { nperseg: Math.min(256, nperseg), overlap: 0.75, maxHz: Math.min(60, ui.fs / 2) }), compute('flagArtifacts', x, ui.fs, { epochSec: 1, zThreshold: 4 })]);
    const maxHz = Math.min(60, ui.fs / 2);
    const run = await logRun('signal-welch-psd', { source: ui.source, samplingRate: ui.fs, nSamples: raw.length, filters: filt, nperseg }, { peakHz: w.peak.hz, bands: w.bands, spectralEntropy: w.spectralEntropy, aperiodic: w.aperiodic, ratios: w.ratios, flaggedEpochs: art.flagged });
    $('#sig-metrics').innerHTML = `<div class="eyebrow">${ui.source === 'synthetic' ? 'Synthetic demonstration signal' : 'Your signal · analyzed locally'}</div>
      <div class="result-big">${fmt(w.peak.hz, 2)} <small>Hz peak (1–45 Hz)</small></div>
      <p class="muted small">${raw.length.toLocaleString()} samples · ${(raw.length / ui.fs).toFixed(1)} s · ${w.segments} Welch segments · resolution ${fmt(w.resolution)} Hz</p>
      ${w.bands.map(b => `<div class="bar-row"><span>${b.name}</span><div class="bar-track"><div class="bar-fill" style="width:${b.power.toFixed(1)}%"></div></div><span class="num">${b.power.toFixed(1)}%</span></div>`).join('')}
      <div class="metrics">${metric('Aperiodic exponent', w.aperiodic ? fmt(w.aperiodic.exponent, 2) : '—', w.aperiodic ? `R² ${fmt(w.aperiodic.r2, 2)} · ${w.aperiodic.range.join('–')} Hz` : '')}${metric('Spectral entropy', fmt(w.spectralEntropy, 3), 'normalized 0–1')}${metric('θ/β ratio', fmt(w.ratios.thetaBeta, 2))}${metric('Flagged epochs', `${art.flagged}/${art.epochs.length}`, '|z| > 4, 1 s epochs')}</div>
      <div class="actions"><button class="btn small" id="dl-sig">${icon('download', 14)} Export analysis</button><span class="muted small mono">sha256 ${run.inputSha256.slice(0, 12)}…</span></div>`;
    $('#dl-sig').onclick = () => download('cerebro-signal-analysis.json', JSON.stringify({ ...run, spectrum: w.spectrum.filter(s => s.hz <= maxHz) }, null, 2));
    const psd = s => s.spectrum.filter(p => p.hz > 0 && p.hz <= maxHz && p.power > 0).map(p => [p.hz, p.power]);
    $('#sig-charts').innerHTML = `<h3>Waveform${filt.highpass || filt.lowpass || filt.notch ? ' (filtered)' : ''}</h3>${lineChart([{ points: decimate(x).map(([i, v]) => [i / ui.fs, v]) }], { xLabel: 'Time (s)', yLabel: 'Amplitude (a.u.)', title: 'Signal waveform' })}
      <h3 style="margin-top:14px">Power spectral density (Welch)</h3>${lineChart([{ label: 'Filtered', points: psd(w) }, ...(x !== raw ? [{ label: 'Raw', points: psd(wRaw), dashed: true, c: 2 }] : [])], { xLabel: 'Frequency (Hz)', yLabel: 'PSD (a.u.²/Hz, log)', logY: true, title: 'Welch PSD' })}
      <h3 style="margin-top:14px">Spectrogram</h3>${heatmap(spec)}`;
  } catch (e) { err.textContent = e.message; }
  finally { btn.disabled = false; }
}

export function render(body) {
  body.innerHTML = notice('Exploratory signal analysis, not clinical EEG interpretation. Band definitions vary across studies; artifact flagging is a simple amplitude screen, not artifact rejection.')
    + `<div class="split"><section class="card"><h2>Signal studio</h2>
      <label class="field">Source<select id="src"><option value="synthetic">Synthetic EEG-like signal</option><option value="paste">Paste samples</option><option value="csv">CSV (one column per channel)</option></select></label>
      <div id="src-fields"></div>
      <div class="form-grid"><label class="field">Sampling rate (Hz)<input id="fs" type="number" value="${ui.fs}" min="16" max="50000"></label><label class="field">Welch segment<select id="nperseg">${[128, 256, 512, 1024, 2048].map(v => `<option ${v === ui.nperseg ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">High-pass (Hz)<input id="hp" type="number" step="0.1" min="0" value="${ui.hp}"></label><label class="field">Low-pass (Hz)<input id="lp" type="number" step="1" min="0" value="${ui.lp}"></label>
      <label class="field full">Notch<select id="notch"><option value="0">Off</option><option value="50" ${ui.notch === 50 ? 'selected' : ''}>50 Hz (EU/Asia mains)</option><option value="60" ${ui.notch === 60 ? 'selected' : ''}>60 Hz (Americas mains)</option></select></label></div>
      <button class="btn primary" id="run-sig" style="width:100%">${icon('wave', 16)} Analyze signal</button><div class="error" id="sig-err" role="alert"></div>
      <p class="method-note">Zero-phase (forward–backward) 2nd-order Butterworth sections → Welch PSD (periodic Hann, 50% overlap, density scaling) → relative band power over [1, 45) Hz, spectral entropy, aperiodic exponent from a log–log fit (2–40 Hz). Heavy computation runs in a Web Worker.</p></section>
      <section class="card"><div id="sig-metrics"></div></section></div>
      <section class="card" style="margin-top:18px"><div id="sig-charts"></div></section>`;
  const src = $('#src'); src.value = ui.source;
  const fields = () => {
    ui.source = src.value;
    $('#src-fields').innerHTML = ui.source === 'synthetic'
      ? `<label class="field">Alpha frequency <span id="af">${ui.alpha}</span> Hz<input id="alpha" type="range" min="6" max="14" step="0.5" value="${ui.alpha}"></label><div class="form-grid"><label class="field">Alpha amplitude<input id="amp" type="number" step="0.1" min="0" max="20" value="${ui.amp}"></label><label class="field">Noise SD<input id="noise" type="number" step="0.1" min="0" max="20" value="${ui.noise}"></label><label class="field">Mains interference<select id="line"><option value="0">None</option><option value="50" ${ui.line === 50 ? 'selected' : ''}>50 Hz</option><option value="60" ${ui.line === 60 ? 'selected' : ''}>60 Hz</option></select></label><label class="field">Duration (s)<input id="secs" type="number" min="2" max="600" value="${ui.seconds}"></label></div>`
      : ui.source === 'paste' ? '<label class="field">Samples<textarea id="paste" class="code" placeholder="0.12, 0.31, -0.08, …"></textarea><small class="hint">Comma-, space- or newline-separated.</small></label>'
        : `<label class="field">CSV file<input type="file" id="sig-file" accept=".csv,.tsv,.txt"></label>${ui.csv ? `<label class="field">Channel<select id="chan">${ui.csv.headers.map((h, i) => `<option value="${i}" ${i === ui.channel ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>` : ''}`;
    if (ui.source === 'synthetic') {
      $('#alpha').oninput = e => { ui.alpha = Number(e.target.value); $('#af').textContent = ui.alpha; };
      $('#amp').onchange = e => { ui.amp = Number(e.target.value); };
      $('#noise').onchange = e => { ui.noise = Number(e.target.value); };
      $('#line').onchange = e => { ui.line = Number(e.target.value); };
      $('#secs').onchange = e => { ui.seconds = Math.min(600, Math.max(2, Number(e.target.value))); };
    }
    if (ui.source === 'csv') {
      $('#sig-file').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 100e6) { toast('Choose a file under 100 MB.', 'error'); return; } try { ui.csv = f.size > 3e5 ? await compute('parseCSV', await f.text()) : parseCSV(await f.text()); ui.channel = 0; fields(); toast(`${f.name}: ${ui.csv.rows.length.toLocaleString()} samples × ${ui.csv.headers.length} channels`); } catch (x) { toast(x.message, 'error'); } };
      $('#chan')?.addEventListener('change', e => { ui.channel = Number(e.target.value); });
    }
  };
  src.onchange = fields; fields();
  $('#run-sig').onclick = analyze;
  analyze();
}
