// Cerebro OS — runtime egress guard.
// Defense in depth behind the Content-Security-Policy: every fetch, beacon and WebSocket
// is checked against policy.mjs. OpenAI/ChatGPT endpoints are always refused.
import { egressDecision } from './policy.mjs';

const blocked = [];
export const blockedRequests = () => blocked.slice();

function record(url, reason) {
  blocked.unshift({ url: String(url).slice(0, 200), reason, at: new Date().toISOString() });
  blocked.length = Math.min(blocked.length, 50);
  console.warn(`[Cerebro OS] Blocked request to ${url}: ${reason}`);
}

export function installGuard(scope = globalThis) {
  if (scope.__cerebroGuard) return;
  scope.__cerebroGuard = true;
  const origin = scope.location?.origin;
  const nativeFetch = scope.fetch.bind(scope);
  scope.fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const d = egressDecision(url, origin);
    if (!d.allowed) { record(url, d.reason); return Promise.reject(new TypeError(`Blocked by Cerebro OS egress policy: ${d.reason}`)); }
    return nativeFetch(input, init);
  };
  if (scope.navigator?.sendBeacon) {
    const nativeBeacon = scope.navigator.sendBeacon.bind(scope.navigator);
    scope.navigator.sendBeacon = (url, data) => { const d = egressDecision(url, origin); if (!d.allowed) { record(url, d.reason); return false; } return nativeBeacon(url, data); };
  }
  if (scope.WebSocket) {
    const NativeWS = scope.WebSocket;
    scope.WebSocket = class extends NativeWS {
      constructor(url, protocols) {
        const d = egressDecision(String(url).replace(/^ws/, 'http'), origin);
        if (!d.allowed) { record(url, d.reason); throw new TypeError(`Blocked by Cerebro OS egress policy: ${d.reason}`); }
        super(url, protocols);
      }
    };
  }
  // Refuse to run inside a frame owned by another site (frame-ancestors covers servers that send headers;
  // this covers static hosts that cannot).
  try {
    if (scope.top && scope.top !== scope.self) {
      scope.document?.documentElement?.replaceChildren?.();
      scope.top.location = scope.self.location.href;
    }
  } catch { scope.document?.documentElement?.replaceChildren?.(); }
}
