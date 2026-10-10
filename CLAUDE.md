# Cerebro OS — notes for Claude sessions

Read `docs/ROADMAP.md` first: it holds the product summary, current state and the phased build-out/scaling plan.

## Rules
- **Ports:** use only the 4700 block (4700 server, 4701 dev, 4702 nginx), bound to 127.0.0.1. Never use the ports reserved by the owner's other local platforms; the list is in `docs/PORTS.md`, and `tests/ports.test.mjs` enforces it. Record any new port in `docs/PORTS.md` and in the test.
- **OpenAI/ChatGPT:** never add OpenAI endpoints, SDKs, embeds or crawler allowances. Policy lives in `web/app/js/policy.mjs`; after changing it, run `npm run gen:hosts`.
- **Honesty:** no fabricated testimonials, logos, usage numbers, certifications or superiority claims. Research use only; not a medical device.
- **Design:** scientific editorial. Tokens are in `web/assets/css/tokens.css`. No gradients, glass, glow or decorative animation; fonts are self-hosted, with no third-party requests.
- **Git:** work on a branch, open a draft PR, merge to `main` only when the owner explicitly says so.

## Commands
```sh
npm start            # http://127.0.0.1:4700  (no npm install needed; Node >= 20)
npm run dev          # http://127.0.0.1:4701 with access logs
npm test             # all test suites
npm run check        # syntax-check every module
npm run check:hosts  # verify generated host configs match policy.mjs
npm run gen:hosts    # regenerate host configs after editing policy.mjs
npm run refresh:openai  # update OpenAI crawler IP ranges
```

## Layout
- `web/`: static site root. `index.html` is the landing page; `app/` is the workspace; `lib/` is the scientific engines.
- `server/`: zero-dependency Node server and OpenAI bot policy.
- `deploy/`: nginx, Cloudflare Worker, Vercel middleware, docker-compose and k8s manifests.
- `docs/`: ROADMAP, DEPLOYMENT, PORTS, VALIDATION.
