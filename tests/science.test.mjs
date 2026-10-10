// Numerical verification for the Cerebro OS scientific core.
// Reference values were computed independently with SciPy 1.x (see docs/VALIDATION.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../web/lib/science.mjs';

const near = (a, b, tol = 1e-8) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b} (tol ${tol})`);

test('AXON v0.1 compatibility: original 32 parser and numeric checks', () => {
  const { parseCSV, describe, metaAnalyze, sampleSize, signalSpectrum } = S;
  assert.deepEqual(parseCSV('﻿name,value\r\n"A, B",2\r\n"Line\n2",3').rows, [['A, B', '2'], ['Line\n2', '3']]);
  assert.throws(() => parseCSV('a,b\n1,2,3'));
  assert.throws(() => parseCSV('a,a\n1,2'));
  assert.throws(() => parseCSV('a,b\n"x,2'));
  const d = describe(['1', '2', '3', '4', '', 'NaN', 'abc']); near(d.mean, 2.5); near(d.sd, Math.sqrt(5 / 3)); near(d.median, 2.5); assert.equal(d.missing, 3);
  assert.equal(describe(['']).n, 0); assert.equal(describe(['3']).sd, null);
  const m = metaAnalyze([{ effect: 1, se: 1 }, { effect: 3, se: 1 }]); near(m.estimate, 2); near(m.se, Math.SQRT1_2); near(m.q, 2); near(m.i2, 50); near(m.tau2, 1); near(m.weights[0], .5);
  const mr = metaAnalyze([{ effect: 1, se: 1 }, { effect: 3, se: 1 }], true); near(mr.estimate, 2); near(mr.se, 1); near(mr.lower, 2 - 1.959963984540054); // v0.1 used the rounded 1.96; Cerebro uses the exact quantile
  const homogeneous = metaAnalyze([{ effect: .5, se: .1 }, { effect: .5, se: .2 }], true); near(homogeneous.tau2, 0); near(homogeneous.i2, 0);
  assert.throws(() => metaAnalyze([{ effect: 0, se: 0 }, { effect: 1, se: 1 }]));
  assert.deepEqual(sampleSize(.5, .8, .05, .15), { perGroup: 63, recruitPerGroup: 75 });
  assert.ok(sampleSize(.2).perGroup > sampleSize(.5).perGroup);
  assert.throws(() => sampleSize(0)); assert.throws(() => sampleSize(.5, .8, .05, 1));
  const signal = Array.from({ length: 512 }, (_, i) => Math.sin(2 * Math.PI * 10 * i / 128));
  const spectrum = signalSpectrum(signal, 128); near(spectrum.peak.hz, 10); assert.ok(spectrum.bands.find(b => b.name === 'Alpha').power > 99.9);
  near(spectrum.spectrum.reduce((a, b) => a + b.power * 128 / 512, 0), .5, 1e-5);
  near(spectrum.bands.reduce((a, b) => a + b.power, 0), 100, 1e-7);
  assert.throws(() => signalSpectrum([1, 2, 3], 128));
  assert.ok(signalSpectrum(Array(128).fill(0), 128).bands.every(b => b.power === 0));
});

test('distributions match SciPy', () => {
  near(S.normalCdf(1.959963984540054), 0.975, 1e-12);
  near(S.normalInv(0.975), 1.959963984540054, 1e-10);
  near(S.normalCdf(-8), 6.22096057427178e-16, 1e-20);
  near(S.tInv(0.975, 10), 2.2281388519649385, 1e-8);
  near(S.chiSqCdf(3.841458820694124, 1), 0.95, 1e-10);
  near(S.nctCdf(1.979, 126, 0.5 * Math.sqrt(32)), 0.19854954513038042, 1e-9);
});

test('hypothesis tests match SciPy', () => {
  const w = S.tTest2([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]); near(w.t, -1.8973665961010275); near(w.df, 5.882352941176471); near(w.p, 0.10753119493062728, 1e-10);
  near(S.tTest2([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], { equalVar: true }).p, 0.09434977284243762, 1e-10);
  const pt = S.pairedTTest([1, 2, 3, 4, 5], [2, 4, 5, 4, 7]); near(pt.t, -3.5); near(pt.p, 0.024896163460222765, 1e-10);
  const mw = S.mannWhitney([1, 2, 3, 9], [4, 5, 6, 7, 8]); near(mw.U, 5); near(mw.p, 0.2703441406547801, 1e-10);
  const a = S.anova([[1, 2, 3], [4, 5, 6], [7, 8, 10]]); near(a.F, 20.84615384615382, 1e-9); near(a.p, 0.00199117183041859, 1e-10);
  const kw = S.kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 10]]); near(kw.H, 7.2, 1e-9); near(kw.p, 0.02732372244729252, 1e-10);
  const c = S.chiSquare([[10, 20], [30, 25]]); near(c.chi2, 3.505892255892255, 1e-9); near(c.p, 0.06115089757606777, 1e-10);
  const r = S.pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]); near(r.r, 0.8); near(r.p, 0.10408803866182782, 1e-10);
  near(S.spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]).r, 0.8);
});

test('OLS regression matches NumPy least squares', () => {
  const m = S.ols([[1, 2], [2, 1], [3, 4], [4, 3], [5, 6], [6, 5], [7, 8]], [3, 4, 8, 8, 12, 12, 16.5], ['a', 'b']);
  [0.29464286, 1.22321429, 0.9375].forEach((b, i) => near(m.coef[i].estimate, b, 1e-7));
  [0.28853702, 0.14516367, 0.13010412].forEach((s, i) => near(m.coef[i].se, s, 1e-7));
  near(m.r2, 0.9966163456533056, 1e-10);
});

test('survival: Kaplan–Meier and log-rank', () => {
  const km = S.kaplanMeier([1, 2, 3, 4, 5], [1, 0, 1, 1, 0]);
  near(km.steps.at(-1).s, 0.8 * (2 / 3) * 0.5);
  assert.equal(km.median, 4);
  const t = [5, 6, 6, 2.5, 4, 4, 7, 8, 10, 9, 11, 12], e = [1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0], g = [...Array(6).fill('A'), ...Array(6).fill('B')];
  const lr = S.logRank(t, e, g); near(lr.chi2, 2.8598179060406372 ** 2, 1e-8); near(lr.p, 0.0042388432433336735, 1e-10);
});

test('meta-analysis heterogeneity estimators match likelihood optimisation', () => {
  const st = [-0.9, -0.1, -0.6, 0.3, -0.2, -1.1].map((effect, i) => ({ effect, se: [0.15, 0.12, 0.2, 0.18, 0.1, 0.25][i] }));
  near(S.tau2DL(st), 0.173683126541957, 1e-12);
  near(S.tau2REML(st), 0.2336775005700517, 1e-7);
  near(S.tau2PM(st), 0.24116509205210404, 1e-9);
  const r = S.metaAnalyze(st, { model: 'random', tau2Method: 'DL', hksj: true });
  near(r.estimate, -0.4124170220048292, 1e-12); near(r.lower, -0.9552623647014212, 1e-8);
  assert.ok(r.prediction[0] < r.lower && r.prediction[1] > r.upper);
  assert.equal(S.leaveOneOut(st).length, 6);
  assert.equal(S.cumulative(st).length, 5);
  const e = S.eggerTest(st); assert.ok(Number.isFinite(e.p));
});

test('effect-size conversions', () => {
  const or = S.twoByTwo(10, 90, 20, 80); near(or.effect, Math.log(10 * 80 / (90 * 20))); near(or.se, Math.sqrt(1 / 10 + 1 / 90 + 1 / 20 + 1 / 80));
  const g = S.smd(10, 2, 20, 9, 2, 20); near(g.d, 0.5); near(g.g, 0.5 * (1 - 3 / 151));
  assert.deepEqual(S.adjustP([0.01, 0.04, 0.03, 0.005], 'BH').map(v => +v.toFixed(4)), [0.02, 0.04, 0.04, 0.02]);
});

test('exact power matches G*Power / SciPy noncentral t', () => {
  const r = S.tTestSampleSize(0.5, 0.8, 0.05); assert.equal(r.n1, 64); assert.equal(r.total, 128); near(r.achievedPower, 0.8014595579222541, 1e-8);
  assert.equal(S.tTestSampleSize(0.5, 0.8, 0.05, { design: 'paired' }).n1, 34);
  assert.ok(S.proportionsSampleSize(0.3, 0.5).n1 > 80);
  assert.equal(S.correlationSampleSize(0.3).total, 85);
  assert.ok(S.survivalSampleSize(0.7).events > 240);
  near(S.minimumDetectableEffect(64), 0.5, 0.01);
});

test('signal: FFT, Welch PSD, filters', () => {
  const x = Array.from({ length: 100 }, (_, i) => Math.sin(i) + i * 0.01);
  const { re, im } = S.fft(x); // Bluestein path vs naive DFT
  for (const k of [0, 1, 7, 50]) {
    let r = 0, m = 0; x.forEach((v, n) => { r += v * Math.cos(2 * Math.PI * k * n / 100); m -= v * Math.sin(2 * Math.PI * k * n / 100); });
    near(re[k], r, 1e-9); near(im[k], m, 1e-9);
  }
  const fs = 256, sig = Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * 10 * i / fs));
  const w = S.welch(sig, fs, { nperseg: 256, overlap: 0.5 }); near(w.peak.hz, 10); near(w.spectrum.reduce((a, b) => a + b.power, 0) * w.resolution, 0.5, 1e-9);
  const mixed = Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * 10 * i / fs) + Math.sin(2 * Math.PI * 50 * i / fs));
  const notched = S.filterSignal(mixed, fs, { notch: 50 }), after = S.welch(notched, fs);
  const p50 = after.spectrum.find(s => s.hz === 50).power, p10 = after.spectrum.find(s => s.hz === 10).power;
  assert.ok(p50 < p10 * 1e-3, 'notch attenuates 50 Hz by >30 dB');
  const pink = S.aperiodicFit(Array.from({ length: 80 }, (_, i) => ({ hz: i + 1, power: 1 / (i + 1) ** 1.5 })));
  near(pink.exponent, 1.5, 1e-9);
  assert.ok(S.spectrogram(sig, fs).frames.length > 10);
});

test('CSV: delimiter detection and profiling', () => {
  const d = S.parseCSV('a;b;c\n1;x;"3;4"\n2;y;5'); assert.equal(d.delimiter, ';'); assert.deepEqual(d.rows[0], ['1', 'x', '3;4']);
  const p = S.profileColumns(S.parseCSV('id,grp,val\n1,A,2.5\n2,B,NA\n3,A,4'));
  assert.equal(p[2].type, 'numeric'); assert.equal(p[2].missing, 1); assert.equal(p[1].type, 'categorical');
  assert.equal(S.profileColumns(S.parseCSV('x\n0\n1\n1'))[0].type, 'binary');
  assert.equal(S.histogram([1, 2, 2, 3, 3, 3, 4]).reduce((a, b) => a + b.count, 0), 7);
});
