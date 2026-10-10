// Cerebro OS — compute worker. Keeps heavy numerical work (large CSVs, long signals,
// spectrograms) off the UI thread so the workspace stays responsive at scale.
import * as S from './science.mjs';

const ALLOWED = new Set(['parseCSV', 'profileColumns', 'welch', 'filterSignal', 'spectrogram', 'flagArtifacts', 'signalSpectrum', 'metaAnalyze', 'leaveOneOut', 'cumulative', 'eggerTest', 'ols', 'kaplanMeier', 'logRank', 'powerCurve', 'tTestSampleSize']);

self.onmessage = async e => {
  const { id, fn, args } = e.data;
  try {
    if (!ALLOWED.has(fn)) throw Error(`Unknown compute function: ${fn}`);
    const result = await S[fn](...args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
