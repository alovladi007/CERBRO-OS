// Applies a stored light/dark choice before first paint (classic, render-blocking script; no inline JS under the CSP).
try { var t = localStorage.getItem('cerebro-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* storage unavailable */ }
