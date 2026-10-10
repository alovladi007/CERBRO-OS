# Numerical validation

`tests/science.test.mjs` compares Cerebro OS engines with reference values computed independently using SciPy 1.x and NumPy. The values were produced in a separate Python environment, not by Cerebro code.

| Engine | Reference | Tolerance |
|---|---|---|
| Normal CDF / inverse, t quantile, χ² CDF | `scipy.stats.norm`, `t.ppf`, `chi2.cdf` | 1e-8 – 1e-12 |
| Noncentral t CDF (Lenth AS 243) | `scipy.stats.nct.cdf(1.979, 126, 2.828)` = 0.198549545 | 1e-9 |
| Welch / Student / paired t | `ttest_ind(equal_var=False/True)`, `ttest_rel` | 1e-10 (p) |
| Mann–Whitney U (asymptotic, continuity) | `mannwhitneyu(method='asymptotic')` | 1e-10 |
| One-way ANOVA, Kruskal–Wallis | `f_oneway`, `kruskal` | 1e-9 |
| Pearson χ² (no correction) | `chi2_contingency(correction=False)` | 1e-10 |
| Pearson / Spearman | `pearsonr`, `spearmanr` | 1e-10 |
| OLS coefficients, SEs, R² | `numpy.linalg.lstsq` + analytic covariance | 1e-7 |
| Log-rank | `scipy.stats.logrank` (z² = χ²) | 1e-8 |
| τ² REML / Paule–Mandel | Direct maximization of the restricted likelihood / Brent root of the generalized Q | 1e-7 / 1e-9 |
| DL τ², Hartung–Knapp CI | Closed form in NumPy | 1e-8 |
| Two-sample power, d=0.5, α=0.05, 80% | Noncentral t search (64/group; matches G*Power) | exact n |
| FFT (Bluestein, n=100) | Naive DFT | 1e-9 |
| Welch PSD peak and Parseval | `scipy.signal.welch(nperseg=256, noverlap=128)` | 1e-9 |
| 50 Hz notch | Attenuation > 30 dB | — |
| Aperiodic fit | Synthetic 1/f^1.5 spectrum | 1e-9 |

The 32 original AXON v0.1 checks are kept. One expected value changed: the random-effects lower bound now uses the exact normal quantile 1.959964 instead of the rounded 1.96.

These tests show that the arithmetic matches reference implementations. They do not validate scientific conclusions, data quality or clinical use.
