# Deploying Cerebro OS

Cerebro OS is a static, buildless web app (`web/`) plus an optional zero-dependency Node server
(`server/`). The operator does **not** permit OpenAI / ChatGPT agents to access the platform. This
document covers how to run it, how to scale it, and how that block works on each hosting target,
including what it cannot do.

Everything that encodes policy comes from one file, `web/app/js/policy.mjs`: the research egress
allowlist, the OpenAI host list, OpenAI's user-agent tokens, the CSP and the security headers. The
Node server imports it directly. Static hosts can't import it, so `npm run gen:hosts` writes their
configs from it, and `npm test` fails if any generated file has drifted.

## Requirements

- Node.js 20 or newer (tested on 22). There are no npm dependencies, so you don't need `npm install`.

## Run locally

```sh
npm start                    # http://127.0.0.1:4700
npm run dev                  # http://localhost:4701 with access logs
npm test                     # node:test suites (policy, server, science)
npm run check                # node --check on every .js/.mjs file
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `4700` | Listen port |
| `HOST` | `127.0.0.1` | Listen address (loopback only by default; the Docker image sets `0.0.0.0` inside the container, and compose publishes it on 127.0.0.1) |
| `WEB_ROOT` | `../web` (relative to `server/`) | Directory to serve |
| `TRUST_PROXY` | `0` | `1` = take the client IP from `CF-Connecting-IP`, else the first `X-Forwarded-For` entry. Enable this **only** behind a proxy or load balancer that sets those headers, because otherwise clients can spoof them. |
| `REFRESH_OPENAI_RANGES` | `0` | `1` = fetch OpenAI's published IP ranges at boot and every 24 h. On failure the server keeps the bundled snapshot and never crashes. |
| `RATE_LIMIT` | `300` | Requests per minute per client IP (token bucket). `0` disables it. The limit applies per process (see Scaling). |
| `LOG` | `1` | `0` disables the JSON access and audit logs on stdout |
| `WORKERS` | `1` | `n` or `auto` (= `os.availableParallelism()`) forks that many `node:cluster` workers |
| `CACHE_MB` | `64` | In-memory LRU budget for file bodies plus their gzip/brotli variants |

Endpoints: `/healthz` (liveness, `{"status":"ok"}`), `/readyz` (readiness, returns 503 while
draining on SIGTERM) and `/api/policy` (JSON that describes the active bot policy: UA tokens,
IP-range counts and dates, and the egress allowlist; the Settings page can use it).

Behavior of the server:

- **Static files:** traversal-safe path resolution (`..`, encoded `..`, backslashes and NUL return
  400). Dotfiles return 404, except `/.well-known/`. Symlinks that point outside the web root are
  refused.
- **Caching:** strong content-hash ETags with `304` responses. HTML, `sw.js`, `robots.txt` and
  `ai.txt` get `no-cache`. Other assets get `public, max-age=3600, must-revalidate`, because
  filenames aren't content-hashed, so `immutable` would be unsafe.
- **Compression:** gzip and brotli, negotiated per request and cached in memory.
- **Methods:** GET and HEAD only; anything else gets 405 with an `Allow` header.
- **Errors:** missing paths serve `web/404.html` with status 404.
- **Headers:** every response carries the security headers from `policy.mjs`. On plain-HTTP
  loopback hosts (`localhost`) the server drops `upgrade-insecure-requests` from the CSP. Without
  that, local development over `http://` would break.
- **Shutdown:** on SIGTERM or SIGINT the server marks itself not-ready, stops accepting
  connections, finishes in-flight requests and exits (forced exit after 10 s).

## Docker

```sh
docker build -t cerebro-os .
docker run --rm -p 127.0.0.1:4700:4700 -e REFRESH_OPENAI_RANGES=1 cerebro-os
docker compose -f deploy/docker-compose.yml up --build
docker compose -f deploy/docker-compose.yml --profile nginx up   # + static nginx edge on 127.0.0.1:4702
```

The image is `node:22-alpine` running as the unprivileged `node` user, and contains only
`package.json`, `server/` and `web/`. It sets `WORKERS=auto` and has a `HEALTHCHECK` that calls
`/healthz` with Node's built-in `fetch` (Alpine doesn't include curl).

## Pretrained model weights

Model weights listed in `web/models/registry.json` are not in git (the first model is 67 MB). Run
`npm run fetch:models` before `npm start`, `docker build` or a static deploy, so the weights are
served from `/models/<id>/`. The script downloads each file from its pinned revision and refuses
it if the SHA-256 differs. Without the weights, the app still works: users choose the file on their
own device, and the browser verifies its hash before using it. Files over 4 MB (the WebAssembly
runtime and the weights) are streamed from disk rather than cached in memory or recompressed.
The CSP allows `'wasm-unsafe-eval'` so the self-hosted runtime can compile WebAssembly; it does
not allow `eval`.

## Kubernetes and scaling

`deploy/k8s.yaml` defines:

- a Deployment with 3 replicas, rolling updates with no unavailability, readiness on `/readyz`,
  liveness on `/healthz`, a `preStop` sleep, a read-only root filesystem, a non-root user and
  resource requests and limits;
- a ClusterIP Service;
- a CPU-based HorizontalPodAutoscaler (3 to 20 replicas);
- a PodDisruptionBudget.

How to scale:

- **The server is stateless.** Each replica serves the same immutable tree. It holds only bounded
  in-memory caches: the file LRU, rate-limit buckets that are swept when idle, and the range table.
  You can add replicas behind any load balancer without coordination.
- **Inside one container**, `WORKERS=auto` uses `node:cluster` to spread connections over all
  cores. In Kubernetes, prefer `WORKERS=1` per pod and let the HPA scale pods.
- **Rate limits are per process.** The effective ceiling is about `RATE_LIMIT × processes` for a
  client whose requests spread across them. For a strict global limit, enforce it at the
  ingress, CDN or WAF.
- **For the largest scale**, put the static files on a CDN (Netlify, Cloudflare, Vercel or nginx
  below). Each of those targets ships the same headers and the same OpenAI block.

## Static hosts and edges (generated: `npm run gen:hosts`)

| Target | Files | OpenAI enforcement |
|---|---|---|
| Netlify | `netlify.toml`, `web/_headers`, `netlify/edge-functions/block-openai.js` | Edge Function: UA + IP ranges (`context.ip`) + Referer/Origin → 403. `robots.txt` and `ai.txt` are excluded. |
| Cloudflare Pages / Workers | `web/_headers`, `deploy/cloudflare-worker.mjs` | Worker on a route in front of the origin: UA + `CF-Connecting-IP` range check (independent of `cf.verifiedBotCategory`) + Referer/Origin. |
| Vercel | `vercel.json`, `deploy/vercel-middleware.js` | Copy `deploy/vercel-middleware.js` to `/middleware.js` at the repo root to enable Routing Middleware (same checks, using `x-real-ip`). `vercel.json` alone only sets headers. |
| nginx | `deploy/nginx.conf`, `deploy/openai-ip-deny.conf` | `map $http_user_agent`, a `geo` include of the IP list, and Referer/Origin maps → 403. `robots.txt` and `ai.txt` are exempt. Every header uses `always`. Includes gzip and an `/app/` fallback. For the official image, use `conf.d/default.conf` + `/etc/nginx/openai-ip-deny.conf`. Behind a load balancer, enable the commented `realip` lines. |

On Netlify, the security headers are defined only once, in `web/_headers`, and not again in
`netlify.toml`. Netlify merges matching rules from both files, and a duplicated value such as
`X-Frame-Options: DENY, DENY` is invalid.

The edge scripts embed the UA regex, the deny-host list and the IP ranges. Their IP parser is the
same code as `server/bot-policy.mjs`, serialised at generation time. Rerun `npm run gen:hosts`
(or `npm run refresh:openai`) after you change `policy.mjs`; `npm test` reports any drift.

## How the OpenAI block works, layer by layer

1. **`robots.txt` (advisory).** `Disallow: /` for GPTBot, ChatGPT-User, OAI-SearchBot and
   ChatGPT-Agent. `ai.txt` refuses AI training. Both files stay readable by every agent so that
   crawlers can learn the policy. Only well-behaved crawlers honour this layer.
2. **User-agent blocking.** Any UA that matches `OPENAI_UA_PATTERN` gets
   `403 Access by OpenAI agents is not permitted by the Cerebro OS operator.` with
   `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store`. The block is logged
   as a JSON `openai-blocked` line. It applies to every path except `robots.txt` and `ai.txt`.
   This stops honest agents, which is everything OpenAI documents as its own traffic.
3. **IP-range blocking.** Requests from OpenAI's published ranges (`server/openai-ranges.json`)
   get the same 403 even when the UA is spoofed. Matching covers IPv4, IPv6 and IPv4-mapped IPv6.
   With `TRUST_PROXY=1` the client IP comes from `CF-Connecting-IP` or `X-Forwarded-For`.
4. **Referer/Origin blocking.** Requests initiated from an OpenAI or ChatGPT page (ChatGPT
   browsing, canvas, link previews that carry a Referer) are refused.
5. **The app never calls OpenAI.** The CSP `connect-src` contains only `'self'` and the five
   research APIs, and the in-app fetch guard (`egressDecision`) rejects OpenAI hosts explicitly.
   No data leaves for OpenAI from the browser, even if a script tries.
6. **No embedding.** `frame-ancestors 'none'` and `X-Frame-Options: DENY` prevent the workspace
   from being framed inside ChatGPT or any other site. `Cross-Origin-Resource-Policy: same-origin`
   prevents cross-origin hotlinking of resources.

### Limits

These measures stop OpenAI's declared agents and its published infrastructure. They cannot stop
the following:

- **A human copy-pasting.** A signed-in user can paste text, screenshots or exported data into
  ChatGPT. No HTTP control can prevent that; it is a terms-of-use and data-governance matter (see
  `web/terms.html`).
- **Unpublished or residential IPs.** Traffic that spoofs a browser UA from IPs OpenAI hasn't
  published, or that goes through residential proxies, VPNs or third-party scrapers, is
  indistinguishable from a normal visitor.
- **ChatGPT Atlas and other AI browsers.** They use a standard Chrome UA from the user's own IP and
  usually don't send a ChatGPT Referer, so they look like ordinary Chrome. The CSP still prevents
  the page from calling OpenAI, but the browser itself can read what the user sees.
- **Robots and ai.txt are voluntary.** Enforcement comes only from layers 2 to 4.
- **Range freshness.** The IP ranges are a snapshot. If they are stale, new OpenAI egress IPs are
  missed until the next refresh.
- **Spoofable proxy headers.** If `TRUST_PROXY=1` is set without a trusted proxy in
  front, a client can choose its own apparent IP. Enable it only behind an LB.

## Refreshing OpenAI's IP ranges

- **Server (automatic):** set `REFRESH_OPENAI_RANGES=1`. The server fetches
  `https://openai.com/{gptbot,chatgpt-user,searchbot}.json` at boot and every 24 h, and falls back
  to the snapshot on error. `/api/policy` shows `origin: "live"` or `"snapshot"` and the dates.
- **Repository and static hosts:** run `npm run refresh:openai`. It rewrites
  `server/openai-ranges.json`, `deploy/openai-ip-deny.conf` and every edge script that embeds the
  ranges. On network failure it exits non-zero and changes no files. Run it on a schedule and
  commit the result, for example with a GitHub Actions workflow:

  ```yaml
  on: { schedule: [{ cron: "17 4 * * *" }], workflow_dispatch: {} }
  jobs:
    refresh:
      runs-on: ubuntu-latest
      permissions: { contents: write, pull-requests: write }
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22 }
        - run: npm run refresh:openai && npm test
        - run: |
            git diff --quiet || { git config user.name ranges-bot; git config user.email ranges-bot@users.noreply.github.com;
              git commit -am "chore: refresh OpenAI crawler IP ranges" && git push; }
  ```

  Or use a host cron entry: `17 4 * * * cd /srv/cerebro-os && npm run refresh:openai && nginx -s reload`.
