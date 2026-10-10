// Cerebro OS — signal processing for electrophysiology exploration.
// FFT (radix-2 + Bluestein for any length), periodogram, Welch PSD, zero-phase
// Butterworth biquad filtering, spectrogram, band power and aperiodic (1/f) fitting.

/** In-place iterative radix-2 FFT. re/im are Float64Array of power-of-two length. */
export function fftRadix2(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const nextPow2 = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** FFT of any length (Bluestein chirp-z for non powers of two). Returns {re, im}. */
export function fft(input) {
  const n = input.length;
  if ((n & (n - 1)) === 0) { const re = Float64Array.from(input), im = new Float64Array(n); fftRadix2(re, im); return { re, im }; }
  const m = nextPow2(2 * n - 1), wr = new Float64Array(n), wi = new Float64Array(n);
  for (let k = 0; k < n; k++) { const a = Math.PI * ((k * k) % (2 * n)) / n; wr[k] = Math.cos(a); wi[k] = -Math.sin(a); }
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
  for (let k = 0; k < n; k++) { ar[k] = input[k] * wr[k]; ai[k] = input[k] * wi[k]; }
  br[0] = wr[0]; bi[0] = -wi[0];
  for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
  fftRadix2(ar, ai); fftRadix2(br, bi);
  for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
  fftRadix2(ar, ai, true);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) { re[k] = ar[k] * wr[k] - ai[k] * wi[k]; im[k] = ar[k] * wi[k] + ai[k] * wr[k]; }
  return { re, im };
}

export const hann = n => Array.from({ length: n }, (_, i) => n === 1 ? 1 : .5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
export const hannPeriodic = n => Array.from({ length: n }, (_, i) => .5 * (1 - Math.cos(2 * Math.PI * i / n)));

/** One-sided PSD of a single segment (density scaling). */
function segmentPSD(seg, fs, win) {
  const n = seg.length, m = seg.reduce((a, b) => a + b, 0) / n, scale = fs * win.reduce((a, b) => a + b * b, 0);
  const { re, im } = fft(seg.map((x, i) => (x - m) * win[i])), out = [];
  for (let k = 0; k <= Math.floor(n / 2); k++) out.push({ hz: k * fs / n, power: (re[k] ** 2 + im[k] ** 2) / scale * (k === 0 || (n % 2 === 0 && k === n / 2) ? 1 : 2) });
  return out;
}

export const BANDS = [['Delta', 1, 4], ['Theta', 4, 8], ['Alpha', 8, 13], ['Beta', 13, 30], ['Gamma', 30, 45]];

function bandSummary(spectrum, fs, df) {
  const top = Math.min(45, fs / 2), total = spectrum.filter(s => s.hz >= 1 && s.hz < top).reduce((a, s) => a + s.power * df, 0);
  const bands = BANDS.map(([name, lo, hi]) => { hi = Math.min(hi, top); const abs = spectrum.filter(s => s.hz >= lo && s.hz < hi).reduce((a, s) => a + s.power * df, 0); return { name, lo, hi, absolute: abs, power: total ? abs / total * 100 : 0 }; });
  return { total, bands };
}

/** AXON v0.1-compatible Hann periodogram (now FFT-backed). 32–2048 samples retained as the documented range. */
export function signalSpectrum(samples, fs) {
  if (samples.length < 32 || samples.length > 2048 || !samples.every(Number.isFinite) || !(fs > 0)) throw Error('Use 32–2048 finite samples and a positive sampling rate.');
  const n = samples.length, spectrum = segmentPSD(samples, fs, hann(n)), { bands } = bandSummary(spectrum, fs, fs / n);
  return { spectrum, bands: bands.map(({ name, lo, hi, power }) => ({ name, lo, hi, power })), peak: spectrum.slice(1).reduce((a, b) => b.power > a.power ? b : a) };
}

/** Welch PSD: averaged, overlapped Hann-windowed periodograms. Scales to millions of samples. */
export function welch(samples, fs, { nperseg = 256, overlap = 0.5 } = {}) {
  if (!samples.every(Number.isFinite) || !(fs > 0)) throw Error('Samples must be finite and sampling rate positive.');
  if (samples.length < 32) throw Error('Use at least 32 samples.');
  nperseg = Math.min(nperseg, samples.length);
  const step = Math.max(1, Math.round(nperseg * (1 - overlap))), win = hannPeriodic(nperseg);
  let acc = null, count = 0;
  for (let start = 0; start + nperseg <= samples.length; start += step) {
    const psd = segmentPSD(samples.slice(start, start + nperseg), fs, win);
    if (!acc) acc = psd.map(p => ({ hz: p.hz, power: 0 }));
    psd.forEach((p, i) => { acc[i].power += p.power; });
    count++;
  }
  acc.forEach(p => { p.power /= count; });
  const df = fs / nperseg, { total, bands } = bandSummary(acc, fs, df), inRange = acc.filter(s => s.hz >= 1 && s.hz < Math.min(45, fs / 2));
  const peak = (inRange.length ? inRange : acc.slice(1)).reduce((a, b) => b.power > a.power ? b : a);
  const pNorm = inRange.map(s => s.power / (inRange.reduce((a, b) => a + b.power, 0) || 1));
  const entropy = -pNorm.reduce((a, p) => a + (p > 0 ? p * Math.log2(p) : 0), 0) / Math.log2(pNorm.length || 2);
  const theta = bands.find(b => b.name === 'Theta').absolute, beta = bands.find(b => b.name === 'Beta').absolute, alpha = bands.find(b => b.name === 'Alpha').absolute;
  return { spectrum: acc, segments: count, resolution: df, total, bands, peak, spectralEntropy: entropy, ratios: { thetaBeta: beta ? theta / beta : null, alphaTheta: theta ? alpha / theta : null }, aperiodic: aperiodicFit(acc, [2, Math.min(40, fs / 2 - 1)]) };
}

/** Aperiodic component: linear fit of log10(power) vs log10(freq) — exponent χ = −slope. */
export function aperiodicFit(spectrum, [lo, hi] = [2, 40]) {
  const pts = spectrum.filter(s => s.hz >= lo && s.hz <= hi && s.power > 0).map(s => [Math.log10(s.hz), Math.log10(s.power)]);
  if (pts.length < 4) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx, offset = my - slope * mx;
  const ssr = pts.reduce((a, p) => a + (p[1] - offset - slope * p[0]) ** 2, 0), sst = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
  return { exponent: -slope, offset, r2: sst ? 1 - ssr / sst : 1, range: [lo, hi] };
}

// ---------- IIR filters (RBJ biquads, zero-phase via forward–backward) ----------
function biquad(type, f0, fs, Q = Math.SQRT1_2) {
  const w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), alpha = Math.sin(w) / (2 * Q);
  let b, a;
  if (type === 'lowpass') b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else if (type === 'highpass') b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  else if (type === 'notch') b = [1, -2 * cw, 1];
  else throw Error('Unknown filter type');
  a = [1 + alpha, -2 * cw, 1 - alpha];
  return { b: b.map(v => v / a[0]), a: [1, a[1] / a[0], a[2] / a[0]] };
}
function applyBiquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = x[0], x2 = x[0], y1 = x[0] * (b[0] + b[1] + b[2]) / (1 + a[1] + a[2]) || 0, y2 = y1;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const filtfilt = (x, f) => applyBiquad(applyBiquad(x, f).reverse(), f).reverse();

/** Zero-phase filter chain. opts: { highpass, lowpass, notch } in Hz (each optional). */
export function filterSignal(samples, fs, { highpass, lowpass, notch } = {}) {
  let y = Float64Array.from(samples);
  const nyq = fs / 2;
  if (highpass) { if (!(highpass > 0 && highpass < nyq)) throw Error('High-pass cutoff must be between 0 and Nyquist.'); y = filtfilt(y, biquad('highpass', highpass, fs)); }
  if (lowpass) { if (!(lowpass > 0 && lowpass < nyq)) throw Error('Low-pass cutoff must be between 0 and Nyquist.'); y = filtfilt(y, biquad('lowpass', lowpass, fs)); }
  if (notch) { if (!(notch > 0 && notch < nyq)) throw Error('Notch frequency must be below Nyquist.'); y = filtfilt(y, biquad('notch', notch, fs, 30)); }
  return Array.from(y);
}

/** Short-time spectrogram for heatmap display. */
export function spectrogram(samples, fs, { nperseg = 128, overlap = 0.75, maxHz = 45 } = {}) {
  nperseg = Math.min(nperseg, samples.length);
  const step = Math.max(1, Math.round(nperseg * (1 - overlap))), win = hannPeriodic(nperseg), frames = [];
  for (let s = 0; s + nperseg <= samples.length; s += step) {
    const psd = segmentPSD(samples.slice(s, s + nperseg), fs, win).filter(p => p.hz <= maxHz);
    frames.push({ t: (s + nperseg / 2) / fs, power: psd.map(p => p.power) });
  }
  const freqs = segmentPSD(new Array(nperseg).fill(0), fs, win).map(p => p.hz).filter(h => h <= maxHz);
  return { freqs, frames };
}

/** Simple amplitude-threshold artifact flagging (|z| > k on epochs). */
export function flagArtifacts(samples, fs, { epochSec = 1, zThreshold = 4 } = {}) {
  const len = Math.max(1, Math.round(epochSec * fs)), m = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, samples.length - 1)) || 1, epochs = [];
  for (let s = 0; s < samples.length; s += len) {
    const seg = samples.slice(s, s + len), peak = Math.max(...seg.map(v => Math.abs(v - m) / sd));
    epochs.push({ start: s / fs, end: Math.min(samples.length, s + len) / fs, peakZ: peak, flagged: peak > zThreshold });
  }
  return { epochs, flagged: epochs.filter(e => e.flagged).length };
}
