// Cerebro OS — boot sequence. The egress guard is installed before any other module runs.
import { installGuard } from './guard.mjs';
installGuard();
try { const t = localStorage.getItem('cerebro-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* ignore */ }
await import('./main.mjs');
