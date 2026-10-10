// Cerebro OS — power and sample-size planning.
// Exact power for t-test designs uses the noncentral t distribution (verified against G*Power values).
import { normalInv, normalCdf, tInv, nctCdf } from './stats.mjs';

/** AXON v0.1 normal-approximation planner (kept for compatibility and as a cross-check). */
export function sampleSize(d, power = .8, alpha = .05, attrition = 0) {
  if (!(d > 0 && d <= 5) || ![.8, .9, .95].includes(power) || ![.05, .01].includes(alpha) || !(attrition >= 0 && attrition < .8)) throw Error('Check effect size, power, alpha, and attrition.');
  const za = alpha === .05 ? 1.9599639845 : 2.5758293035, zb = power === .8 ? .8416212336 : power === .9 ? 1.2815515655 : 1.644853627;
  const perGroup = Math.ceil(2 * (za + zb) ** 2 / d ** 2);
  return { perGroup, recruitPerGroup: Math.ceil(perGroup / (1 - attrition)) };
}

function check(d, power, alpha, attrition = 0) {
  if (!(Math.abs(d) > 0 && Math.abs(d) <= 5)) throw Error('Effect size must be non-zero and at most 5 in magnitude.');
  if (!(power >= 0.5 && power < 1)) throw Error('Power must be between 50% and 99.9%.');
  if (!(alpha > 0 && alpha < 0.5)) throw Error('Alpha must be between 0 and 0.5.');
  if (!(attrition >= 0 && attrition < 0.8)) throw Error('Attrition must be between 0% and 79%.');
}

/** Power of a two-sided test for t-test designs. design: 'two-sample' | 'one-sample' | 'paired'. ratio = n2/n1. */
export function tTestPower(d, n1, alpha = 0.05, { design = 'two-sample', ratio = 1, sides = 2 } = {}) {
  let df, ncp;
  if (design === 'two-sample') { const n2 = Math.ceil(n1 * ratio); df = n1 + n2 - 2; ncp = Math.abs(d) * Math.sqrt(n1 * n2 / (n1 + n2)); }
  else { df = n1 - 1; ncp = Math.abs(d) * Math.sqrt(n1); }
  if (df < 1) return 0;
  const tc = tInv(1 - alpha / sides, df);
  return sides === 2 ? 1 - nctCdf(tc, df, ncp) + nctCdf(-tc, df, ncp) : 1 - nctCdf(tc, df, ncp);
}

/** Smallest n (group 1 / pairs) achieving the target power with the exact noncentral t. */
export function tTestSampleSize(d, power = 0.8, alpha = 0.05, { design = 'two-sample', ratio = 1, sides = 2, attrition = 0 } = {}) {
  check(d, power, alpha, attrition);
  const za = normalInv(1 - alpha / sides), zb = normalInv(power);
  let n = Math.max(2, Math.floor((design === 'two-sample' ? (1 + 1 / ratio) : 1) * (za + zb) ** 2 / d ** 2) - 2);
  while (tTestPower(d, n, alpha, { design, ratio, sides }) < power) n++;
  const n2 = design === 'two-sample' ? Math.ceil(n * ratio) : 0, total = n + n2;
  return { design, n1: n, n2, total, achievedPower: tTestPower(d, n, alpha, { design, ratio, sides }), recruitTotal: Math.ceil(n / (1 - attrition)) + (n2 ? Math.ceil(n2 / (1 - attrition)) : 0), method: 'Exact noncentral t' };
}

/** Two independent proportions (unpooled-variance normal approximation, Fleiss without CC). */
export function proportionsSampleSize(p1, p2, power = 0.8, alpha = 0.05, { ratio = 1, attrition = 0 } = {}) {
  if (!(p1 > 0 && p1 < 1 && p2 > 0 && p2 < 1) || p1 === p2) throw Error('Proportions must be in (0,1) and differ.');
  check(0.1, power, alpha, attrition);
  const za = normalInv(1 - alpha / 2), zb = normalInv(power), pbar = (p1 + ratio * p2) / (1 + ratio), qbar = 1 - pbar;
  const n1 = Math.ceil((za * Math.sqrt(pbar * qbar * (1 + 1 / ratio)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2) / ratio)) ** 2 / (p1 - p2) ** 2);
  const n2 = Math.ceil(n1 * ratio);
  return { n1, n2, total: n1 + n2, recruitTotal: Math.ceil(n1 / (1 - attrition)) + Math.ceil(n2 / (1 - attrition)), method: 'Normal approximation (pooled null variance)' };
}

/** Correlation via Fisher z. */
export function correlationSampleSize(r, power = 0.8, alpha = 0.05, { attrition = 0 } = {}) {
  if (!(Math.abs(r) > 0 && Math.abs(r) < 1)) throw Error('Correlation must be between -1 and 1 and non-zero.');
  check(0.1, power, alpha, attrition);
  const n = Math.ceil(((normalInv(1 - alpha / 2) + normalInv(power)) / Math.atanh(Math.abs(r))) ** 2 + 3);
  return { total: n, recruitTotal: Math.ceil(n / (1 - attrition)), method: 'Fisher z approximation' };
}

/** Time-to-event: required events (Schoenfeld) and total N given overall event probability. */
export function survivalSampleSize(hr, power = 0.8, alpha = 0.05, { allocation = 0.5, eventProb = 0.5, attrition = 0 } = {}) {
  if (!(hr > 0 && hr !== 1 && hr < 20)) throw Error('Hazard ratio must be positive and not equal to 1.');
  if (!(eventProb > 0 && eventProb <= 1)) throw Error('Event probability must be in (0,1].');
  check(0.1, power, alpha, attrition);
  const events = Math.ceil((normalInv(1 - alpha / 2) + normalInv(power)) ** 2 / (allocation * (1 - allocation) * Math.log(hr) ** 2));
  const total = Math.ceil(events / eventProb);
  return { events, total, recruitTotal: Math.ceil(total / (1 - attrition)), method: 'Schoenfeld (log-rank)' };
}

/** Power curve for plotting: power across a range of n for a two-sample design. */
export function powerCurve(d, alpha = 0.05, { design = 'two-sample', ratio = 1, from = 4, to = 400, points = 60 } = {}) {
  const out = [], step = Math.max(1, Math.round((to - from) / points));
  for (let n = from; n <= to; n += step) out.push({ n, power: tTestPower(d, n, alpha, { design, ratio }) });
  return out;
}

/** Minimum detectable effect for fixed n. */
export function minimumDetectableEffect(n1, power = 0.8, alpha = 0.05, opts = {}) {
  let lo = 0.001, hi = 5;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tTestPower(mid, n1, alpha, opts) < power) lo = mid; else hi = mid; }
  return hi;
}
export const zPower = (d, n, alpha = 0.05) => normalCdf(Math.abs(d) * Math.sqrt(n / 2) - normalInv(1 - alpha / 2));
