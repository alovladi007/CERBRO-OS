// Cerebro OS — deterministic synthetic biomarker cohort (fictional patients) for the
// machine-learning tools. Known structure, so users and tests can see whether a method recovers it:
//  • overall survival driven by ECOG, KRAS mutation, gene_01 and age;
//  • objective response driven by arm, TMB, gene_02 and EGFR mutation;
//  • three expression subtypes (A/B/C), each raising four of gene_01 … gene_12;
//  • three sites with different case mix, and ~3% missing values in tmb and gene_05.
import { rng } from './ml.mjs';

export function syntheticBiomarker(n = 420, seed = 17) {
  const r = rng(seed), norm = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const headers = ['patient', 'site', 'sex', 'age', 'ecog', 'arm', 'tmb', 'KRAS_mut', 'TP53_mut', 'EGFR_mut', 'STK11_mut', 'subtype',
    ...Array.from({ length: 12 }, (_, i) => `gene_${String(i + 1).padStart(2, '0')}`), 'os_months', 'death', 'response'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const site = ['A', 'B', 'C'][i % 3], sex = r() < 0.46 ? 'F' : 'M', age = Math.round(Math.min(88, Math.max(30, 64 + norm() * 9 + (site === 'C' ? 4 : 0))));
    const ecog = r() < (site === 'C' ? 0.3 : 0.45) ? 0 : r() < 0.7 ? 1 : 2, arm = i % 2 ? 'Experimental' : 'Control';
    const subtype = ['A', 'B', 'C'][Math.floor(r() * 3)];
    const kras = r() < 0.3 ? 1 : 0, tp53 = r() < 0.5 ? 1 : 0, egfr = !kras && r() < 0.2 ? 1 : 0, stk11 = r() < 0.15 ? 1 : 0;
    const tmb = Math.max(0, Math.exp(1.6 + 0.7 * norm() + (tp53 ? 0.3 : 0)));
    const genes = Array.from({ length: 12 }, (_, g) => norm() + (Math.floor(g / 4) === 'ABC'.indexOf(subtype) ? 2.2 : 0));
    const lp = 0.45 * ecog + 0.6 * kras + 0.4 * genes[0] + 0.02 * (age - 64) + (site === 'C' ? 0.25 : 0) - (arm === 'Experimental' ? 0.3 : 0);
    const tDeath = -Math.log(1 - r()) / (0.03 * Math.exp(lp)), cens = 4 + r() * 44, t = Math.min(tDeath, cens);
    const pResp = 1 / (1 + Math.exp(-(-1.6 + (arm === 'Experimental' ? 0.9 : 0) + 0.12 * tmb + 0.6 * genes[1] + 0.9 * egfr - 0.3 * ecog)));
    const miss = () => r() < 0.03;
    rows.push([`BX${String(i + 1).padStart(3, '0')}`, site, sex, String(age), String(ecog), arm, miss() ? '' : tmb.toFixed(1), String(kras), String(tp53), String(egfr), String(stk11), subtype,
      ...genes.map((v, g) => (g === 4 && miss() ? '' : v.toFixed(3))), t.toFixed(1), tDeath <= cens ? '1' : '0', r() < pResp ? '1' : '0']);
  }
  return { name: `Synthetic biomarker cohort · ${n} fictional patients`, headers, rows };
}
