// Cerebro OS — scientific core barrel.
// Keeps the AXON v0.1 public API (parseCSV, describe, metaAnalyze, sampleSize, signalSpectrum)
// and exposes the extended engines.
import { finite, quantile } from './stats.mjs';

export { parseCSV, profileColumns, toCSV, detectDelimiter } from './csv.mjs';
export * from './stats.mjs';
export { metaAnalyze, eggerTest, leaveOneOut, cumulative, expResult, tau2DL, tau2PM, tau2REML } from './meta.mjs';
export { sampleSize, tTestPower, tTestSampleSize, proportionsSampleSize, correlationSampleSize, survivalSampleSize, powerCurve, minimumDetectableEffect } from './power.mjs';
export { signalSpectrum, welch, filterSignal, spectrogram, aperiodicFit, flagArtifacts, fft, BANDS } from './signal.mjs';

export const METHOD_VERSION = 'cerebro-1.0';

export function describe(values) {
  const nums = finite(values).sort((a, b) => a - b);
  if (!nums.length) return { n: 0, missing: values.length };
  const n = nums.length, mean = nums.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  return { n, missing: values.length - n, mean, median: n % 2 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2, sd, min: nums[0], max: nums[n - 1],
    q1: quantile(nums, 0.25), q3: quantile(nums, 0.75), se: sd != null ? sd / Math.sqrt(n) : null,
    skew: n > 2 && sd ? nums.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) * n / ((n - 1) * (n - 2)) : null };
}

/** Histogram bins (Freedman–Diaconis with Sturges fallback). */
export function histogram(values, maxBins = 40) {
  const nums = finite(values).sort((a, b) => a - b);
  if (!nums.length) return [];
  const lo = nums[0], hi = nums[nums.length - 1];
  if (lo === hi) return [{ x0: lo, x1: hi, count: nums.length }];
  const iqr = quantile(nums, .75) - quantile(nums, .25), fd = iqr ? 2 * iqr / Math.cbrt(nums.length) : 0;
  const k = Math.min(maxBins, Math.max(1, fd ? Math.ceil((hi - lo) / fd) : Math.ceil(Math.log2(nums.length) + 1))), w = (hi - lo) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
  nums.forEach(v => { bins[Math.min(k - 1, Math.floor((v - lo) / w))].count++; });
  return bins;
}

/** SHA-256 hex digest of a string (Web Crypto, available in browsers, workers and Node ≥ 19). */
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
